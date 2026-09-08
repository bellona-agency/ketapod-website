-- +goose Up
-- +goose StatementBegin

-- normalize_fa folds the character variants that make Persian search
-- fail. It has to exist in SQL, not only in Go: normalizing the *query*
-- alone is useless if the *index* still holds the unnormalized text.
-- «قصه‌های» (with a zero-width non-joiner) and «قصه های» are different
-- byte strings, so a search for «قصه» matched one seeded title and
-- missed the other until both sides went through the same fold.
--
-- IMMUTABLE is what allows it inside a generated column and a functional
-- index. That rules out unaccent(), which is only STABLE — the folds
-- below are all translate/replace and therefore genuinely immutable.
CREATE OR REPLACE FUNCTION catalog.normalize_fa(input text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
STRICT
AS $$
    SELECT regexp_replace(
        translate(
            input,
            -- Arabic yeh/alef-maksura -> Persian yeh, Arabic kaf -> Persian kaf,
            -- Arabic-Indic and Persian digits -> ASCII, ZWNJ and bidi marks -> space,
            -- harakat -> removed by the trailing empty targets.
            'يىكﮎﮏﮐﮑ' || '٠١٢٣٤٥٦٧٨٩' || '۰۱۲۳۴۵۶۷۸۹' || E'‌‎‏',
            'یییککک'   || '0123456789'  || '0123456789'  || '   '
        ),
        '[ً-ْ]', '', 'g'
    );
$$;

-- +goose StatementEnd

ALTER TABLE catalog.books DROP COLUMN IF EXISTS search_document;

ALTER TABLE catalog.books
    ADD COLUMN search_document tsvector
    GENERATED ALWAYS AS (
        setweight(to_tsvector('simple', catalog.normalize_fa(coalesce(title, ''))), 'A') ||
        setweight(to_tsvector('simple', catalog.normalize_fa(coalesce(subtitle, ''))), 'B') ||
        setweight(to_tsvector('simple', catalog.normalize_fa(coalesce(description, ''))), 'C')
    ) STORED;

CREATE INDEX idx_books_search_document ON catalog.books USING gin (search_document);

-- Trigram index over the normalized title, so the fuzzy arm of the
-- search (which catches misspellings FTS cannot) is index-backed rather
-- than a sequential scan with a similarity() filter.
CREATE INDEX idx_books_title_norm_trgm
    ON catalog.books USING gin (catalog.normalize_fa(title) gin_trgm_ops);

CREATE INDEX idx_authors_name_norm_trgm
    ON catalog.authors USING gin (catalog.normalize_fa(name) gin_trgm_ops);

-- +goose Down
DROP INDEX IF EXISTS catalog.idx_authors_name_norm_trgm;
DROP INDEX IF EXISTS catalog.idx_books_title_norm_trgm;
DROP INDEX IF EXISTS catalog.idx_books_search_document;
ALTER TABLE catalog.books DROP COLUMN IF EXISTS search_document;
ALTER TABLE catalog.books
    ADD COLUMN search_document tsvector
    GENERATED ALWAYS AS (
        setweight(to_tsvector('simple', coalesce(title, '')), 'A') ||
        setweight(to_tsvector('simple', coalesce(subtitle, '')), 'B') ||
        setweight(to_tsvector('simple', coalesce(description, '')), 'C')
    ) STORED;
CREATE INDEX idx_books_search_document ON catalog.books USING gin (search_document);
DROP FUNCTION IF EXISTS catalog.normalize_fa(text);
