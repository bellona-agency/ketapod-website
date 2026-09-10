import { REFERRAL_REWARD_RIAL } from "@/lib/mock/commerce";
import { db } from "@/lib/mock/db";
import { requireUser } from "@/lib/mock/session";

/**
 * دعوت دوستان.
 *
 * The spec's note is a product decision disguised as a technical one: «لینک
 * دعوت باید صفحه وب باز کند نه اپ، تا کاربر بدون نصب هم بتواند ثبت‌نام کند». So
 * the link built here points at `/join/[code]` — a page — and never at a deep
 * link or a store listing. Someone who receives it on a desktop, or on a phone
 * with no app installed, can still finish signing up.
 *
 * The reward is paid to both sides and only when the invitee actually listens.
 * Paying on signup makes the code worth farming with throwaway numbers; paying
 * on first real use makes it worth sending to someone who wanted it.
 */

export async function GET(req: Request) {
  const auth = await requireUser(req);
  if (auth.response) return auth.response;
  const { user } = auth;

  const invited = db.users
    .filter((u) => u.referredByUserId === user.id)
    .map((u) => {
      const listened = db.listening.some((l) => l.userId === u.id);
      return {
        /* Masked. The inviter is entitled to know their invite worked, not to
           get a list of their friends' phone numbers back from us. */
        phone: `${u.phone.slice(0, 4)}•••${u.phone.slice(-2)}`,
        joinedAt: u.createdAt,
        activated: listened,
      };
    });

  return Response.json({
    code: user.referralCode,
    /* Relative. The absolute form is built by the client against its own
       origin, which is what makes this work on localhost and in production
       without a base URL configured in two places. */
    invitePath: `/join/${user.referralCode}`,
    rewardRial: REFERRAL_REWARD_RIAL,
    invited,
    earnedRial: invited.filter((i) => i.activated).length * REFERRAL_REWARD_RIAL,
  });
}
