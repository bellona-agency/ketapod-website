import {
  badgesOf,
  historyOf,
  levelOf,
  recapDue,
  streakOf,
  totalMinutesOf,
} from "@/lib/mock/growth";
import { requireUser } from "@/lib/mock/session";

/**
 * The learning dashboard, computed.
 *
 * Everything here is a conclusion. The client receives «کتاب‌خوان جدی» and a
 * fraction, never the minute thresholds behind them — which is the spec's rule
 * for this module («قواعد سطح‌بندی در بک‌اند نگهداری شود نه در فرانت») made
 * literal at the wire. A front end that never learns the formula cannot drift
 * from the app that also never learns it.
 */
export async function GET(req: Request) {
  const auth = await requireUser(req);
  if (auth.response) return auth.response;
  const { id } = auth.user;

  const totalMinutes = totalMinutesOf(id);

  return Response.json({
    totalMinutes,
    streak: streakOf(id),
    level: levelOf(totalMinutes),
    badges: badgesOf(id),
    history: historyOf(id),
    recap: recapDue(id),
  });
}
