// Package storage abstracts an S3-compatible object store (MinIO locally,
// an Iranian object storage provider in production — decisions.md rules
// out CloudFront/AWS by policy, not just cost, so the client is built
// with a custom endpoint and path-style addressing everywhere).
package storage

import (
	"context"
	"fmt"
	"io"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

type Config struct {
	Endpoint  string
	Region    string
	Bucket    string
	AccessKey string
	SecretKey string
	UseSSL    bool
}

type Object struct {
	Body          io.ReadCloser
	ContentLength int64
	ContentRange  string
	ContentType   string
	IsPartial     bool
}

type Storage struct {
	client *s3.Client
	bucket string
}

func New(ctx context.Context, cfg Config) (*Storage, error) {
	scheme := "http"
	if cfg.UseSSL {
		scheme = "https"
	}
	endpoint := fmt.Sprintf("%s://%s", scheme, cfg.Endpoint)

	awsCfg, err := awsconfig.LoadDefaultConfig(ctx,
		awsconfig.WithRegion(cfg.Region),
		awsconfig.WithCredentialsProvider(credentials.NewStaticCredentialsProvider(cfg.AccessKey, cfg.SecretKey, "")),
	)
	if err != nil {
		return nil, fmt.Errorf("storage: load aws config: %w", err)
	}

	client := s3.NewFromConfig(awsCfg, func(o *s3.Options) {
		o.BaseEndpoint = aws.String(endpoint)
		o.UsePathStyle = true
	})

	return &Storage{client: client, bucket: cfg.Bucket}, nil
}

func (s *Storage) EnsureBucket(ctx context.Context) error {
	_, err := s.client.HeadBucket(ctx, &s3.HeadBucketInput{Bucket: aws.String(s.bucket)})
	if err == nil {
		return nil
	}
	_, err = s.client.CreateBucket(ctx, &s3.CreateBucketInput{Bucket: aws.String(s.bucket)})
	if err != nil {
		return fmt.Errorf("storage: create bucket: %w", err)
	}
	return nil
}

func (s *Storage) PutObject(ctx context.Context, key string, body io.Reader, contentType string) error {
	_, err := s.client.PutObject(ctx, &s3.PutObjectInput{
		Bucket:      aws.String(s.bucket),
		Key:         aws.String(key),
		Body:        body,
		ContentType: aws.String(contentType),
	})
	if err != nil {
		return fmt.Errorf("storage: put object %q: %w", key, err)
	}
	return nil
}

// GetObject fetches key, optionally scoped to an HTTP Range header value
// (e.g. "bytes=0-1023"). The S3 GetObject API accepts Range verbatim and
// replies with 206-shaped metadata (ContentRange set) when it applies —
// that response is passed straight through to the HTTP layer, which is
// what lets chi's media handler support seeking without buffering the
// whole file in memory.
func (s *Storage) GetObject(ctx context.Context, key string, rangeHeader string) (*Object, error) {
	input := &s3.GetObjectInput{
		Bucket: aws.String(s.bucket),
		Key:    aws.String(key),
	}
	if rangeHeader != "" {
		input.Range = aws.String(rangeHeader)
	}

	out, err := s.client.GetObject(ctx, input)
	if err != nil {
		return nil, fmt.Errorf("storage: get object %q: %w", key, err)
	}

	obj := &Object{
		Body:      out.Body,
		IsPartial: rangeHeader != "" && out.ContentRange != nil,
	}
	if out.ContentLength != nil {
		obj.ContentLength = *out.ContentLength
	}
	if out.ContentRange != nil {
		obj.ContentRange = *out.ContentRange
	}
	if out.ContentType != nil {
		obj.ContentType = *out.ContentType
	}
	return obj, nil
}

func (s *Storage) HeadObject(ctx context.Context, key string) (int64, string, error) {
	out, err := s.client.HeadObject(ctx, &s3.HeadObjectInput{
		Bucket: aws.String(s.bucket),
		Key:    aws.String(key),
	})
	if err != nil {
		return 0, "", fmt.Errorf("storage: head object %q: %w", key, err)
	}
	var length int64
	if out.ContentLength != nil {
		length = *out.ContentLength
	}
	var contentType string
	if out.ContentType != nil {
		contentType = *out.ContentType
	}
	return length, contentType, nil
}

func (s *Storage) PresignPutURL(ctx context.Context, key string, expiry time.Duration) (string, error) {
	presigner := s3.NewPresignClient(s.client)
	req, err := presigner.PresignPutObject(ctx, &s3.PutObjectInput{
		Bucket: aws.String(s.bucket),
		Key:    aws.String(key),
	}, s3.WithPresignExpires(expiry))
	if err != nil {
		return "", fmt.Errorf("storage: presign put %q: %w", key, err)
	}
	return req.URL, nil
}
