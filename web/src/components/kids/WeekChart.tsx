/**
 * Seven days of listening, as bars.
 *
 * Drawn with divs rather than a charting library. Seven values and one
 * reference line do not justify a dependency, and the spec's own leverage
 * section is about not carrying weight that earns nothing.
 *
 * The cap is drawn as a line across the bars rather than as the scale's
 * maximum, because a day that went over the cap has to be *visible* as over —
 * scaling to the cap would clip it to full height and make 46 minutes and 120
 * minutes look identical, which is the one comparison a parent is making.
 */

/** Persian weekday initials, Saturday-first, as an Iranian week runs. */
const WEEKDAY = ["ش", "ی", "د", "س", "چ", "پ", "ج"];

export function WeekChart({
  days,
  capMinutes,
}: {
  days: { day: string; minutes: number }[];
  capMinutes: number | null;
}) {
  const peak = Math.max(...days.map((d) => d.minutes), capMinutes ?? 0, 10);
  const capRatio = capMinutes ? capMinutes / peak : null;

  return (
    <div className="mt-5">
      {/* The value labels sit outside the plot area. Inside it they would eat
          into the height the bars are measured against, and a percentage height
          needs a parent whose height does not depend on its children. */}
      <div className="flex gap-2">
        {days.map((d) => (
          <span
            key={d.day}
            className="tnum flex-1 text-center text-[11px] text-muted"
            aria-hidden
          >
            {d.minutes > 0 ? d.minutes : ""}
          </span>
        ))}
      </div>

      <div className="relative mt-1 flex h-32 items-end gap-2">
        {capRatio !== null && capRatio <= 1 && (
          <div
            className="pointer-events-none absolute inset-x-0 z-10 border-t border-dashed border-violet-300"
            style={{ bottom: `${capRatio * 100}%` }}
          >
            <span className="absolute -top-4 start-0 bg-card px-1 text-[11px] text-violet">
              سقف
            </span>
          </div>
        )}

        {days.map((d) => {
          const over = capMinutes !== null && d.minutes > capMinutes;
          return (
            <div
              key={d.day}
              className={`flex-1 rounded-t-md ${over ? "bg-amber-400" : "bg-violet"}`}
              style={{ height: `${(d.minutes / peak) * 100}%`, minHeight: 3 }}
              /* The bar carries the reading; the weekday letter alone would
                 leave a screen reader with seven unlabelled columns. */
              role="img"
              aria-label={`${d.day}: ${d.minutes} دقیقه`}
            />
          );
        })}
      </div>

      <div className="mt-1.5 flex gap-2">
        {days.map((d) => {
          /* `new Date('YYYY-MM-DD')` parses as UTC and can land on the previous
             day in a positive offset; the explicit midnight keeps it local. */
          const date = new Date(`${d.day}T00:00:00`);
          return (
            <span
              key={d.day}
              className="flex-1 text-center text-[12px] text-faint"
              aria-hidden
            >
              {WEEKDAY[(date.getDay() + 1) % 7]}
            </span>
          );
        })}
      </div>
    </div>
  );
}
