"use client";

import { CornerDownLeft, Loader2, Sparkles } from "lucide-react";
import { useState } from "react";
import {
  ApiError,
  type AssistantAnswer,
  type QuizItem,
  type Recap,
  askAssistant,
  getRecap,
} from "@/lib/platform";

/**
 * کتاب‌یار, inside the player.
 *
 * Every request carries the current second, which is what makes the answers
 * bounded rather than merely relevant. The pane says so on screen: a reader who
 * does not know the assistant is limited to what they have heard would read
 * "تا این‌جای کتاب چیزی درباره این پرسش گفته نشده" as a failure rather than as
 * the feature working.
 *
 * Citations are buttons. An answer assembled from the book's own sentences is
 * only worth more than a plausible paraphrase if the reader can jump to the
 * second it came from and hear it.
 */
export function AssistantPane({
  editionId,
  chapterIndex,
  currentTime,
  onSeek,
}: {
  editionId: string;
  chapterIndex: number | null;
  currentTime: number;
  onSeek: (sec: number) => void;
}) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<AssistantAnswer | null>(null);
  const [recap, setRecap] = useState<Recap>(null);
  const [quiz, setQuiz] = useState<QuizItem[]>([]);
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const ask = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = question.trim();
    if (!q) return;
    setBusy(true);
    setErr(null);
    try {
      setAnswer(
        await askAssistant({
          editionId,
          chapterId: chapterIndex,
          currentTimeSec: currentTime,
          question: q,
        }),
      );
    } catch (error) {
      setErr(error instanceof ApiError ? error.message : "پاسخی نیامد.");
    } finally {
      setBusy(false);
    }
  };

  const loadRecap = async () => {
    setBusy(true);
    setErr(null);
    try {
      const data = await getRecap(editionId, currentTime);
      setRecap(data.recap);
      setQuiz(data.quiz);
      setPicked({});
    } catch {
      setErr("خلاصه ساخته نشد.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card p-5">
      <h2 className="flex items-center gap-2 text-[15px] font-bold text-ink">
        <Sparkles className="size-4 text-violet" strokeWidth={1.9} aria-hidden />
        کتاب‌یار
      </h2>
      <p className="mt-1.5 text-[13px] leading-[1.7] text-muted">
        فقط از آنچه تا این لحظه شنیده‌اید پاسخ می‌دهد — جلوتر نمی‌رود.
      </p>

      <form onSubmit={ask} className="mt-3 flex gap-2">
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="از کتاب بپرسید…"
          aria-label="پرسش از کتاب‌یار"
          className="h-11 min-w-0 flex-1 rounded-lg border border-line bg-paper px-3 text-[15px] text-ink outline-none focus:border-violet"
        />
        <button
          type="submit"
          disabled={busy || !question.trim()}
          aria-label="بپرس"
          className="btn grid size-11 shrink-0 place-items-center rounded-lg bg-violet text-white disabled:opacity-60"
        >
          {busy ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <CornerDownLeft className="size-4" strokeWidth={2} aria-hidden />
          )}
        </button>
      </form>

      <button
        type="button"
        onClick={loadRecap}
        disabled={busy}
        className="mt-2 text-[13px] font-medium text-violet hover:underline disabled:opacity-60"
      >
        تا اینجا چه گذشت؟
      </button>

      {err && <p className="mt-3 text-[14px] text-amber-700">{err}</p>}

      {answer && (
        <div className="mt-4 rounded-lg bg-paper-2 p-3.5">
          <p className="text-[15px] leading-[1.9] text-ink-2">{answer.text}</p>

          {answer.citations.length > 0 && (
            <ul className="mt-3 flex flex-col gap-1">
              {answer.citations.map((c) => (
                <li key={c.startSec}>
                  <button
                    type="button"
                    onClick={() => onSeek(c.startSec)}
                    className="tnum text-[12px] text-violet hover:underline"
                  >
                    ↩ دقیقه {Math.floor(c.startSec / 60)}:
                    {String(Math.floor(c.startSec % 60)).padStart(2, "0")}
                  </button>
                </li>
              ))}
            </ul>
          )}

          <p className="mt-2.5 text-[11px] text-faint">
            از {answer.context.heardCues} جمله شنیده‌شده
          </p>
        </div>
      )}

      {recap && (
        <div className="mt-4 rounded-lg border border-line p-3.5">
          <p className="tnum text-[14px] text-ink">
            فصل {recap.chaptersDone} از {recap.chaptersTotal} · {recap.percent}٪
          </p>
          {recap.currentChapter && (
            <p className="mt-1 text-[14px] text-muted">{recap.currentChapter}</p>
          )}
          {recap.lastLine && (
            <p className="mt-2.5 text-[14px] leading-[1.85] text-ink-2">
              آخرین جمله: «{recap.lastLine}»
            </p>
          )}
        </div>
      )}

      {quiz.length > 0 && (
        <div className="mt-4">
          <h3 className="text-[14px] font-bold text-ink">کوییز</h3>
          <ul className="mt-2 flex flex-col gap-3">
            {quiz.map((q) => (
              <li key={q.id} className="rounded-lg bg-paper-2 p-3">
                <p className="text-[14px] leading-[1.85] text-ink-2">{q.prompt}</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {q.options.map((opt) => {
                    const chosen = picked[q.id];
                    const isRight = opt === q.answer;
                    const state =
                      !chosen || chosen !== opt
                        ? "bg-white text-ink-2"
                        : isRight
                          ? "bg-mint-100 text-mint-ink"
                          : "bg-amber-100 text-amber-700";
                    return (
                      <button
                        key={opt}
                        type="button"
                        onClick={() => setPicked((p) => ({ ...p, [q.id]: opt }))}
                        className={`rounded-md px-2.5 py-1.5 text-[13px] ${state}`}
                      >
                        {opt}
                      </button>
                    );
                  })}
                </div>
                {picked[q.id] && picked[q.id] !== q.answer && (
                  <button
                    type="button"
                    onClick={() => onSeek(q.atSec)}
                    className="mt-2 text-[12px] text-violet hover:underline"
                  >
                    دوباره گوش کن
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
