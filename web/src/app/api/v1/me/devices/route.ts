import { cookies } from "next/headers";
import { TIERS, tierSpec } from "@/lib/mock/commerce";
import { activeSubscription, db } from "@/lib/mock/db";
import { SESSION_COOKIE, requireUser } from "@/lib/mock/session";

/**
 * The devices signed into this account.
 *
 * The spec gives `Device` three jobs — «سقف پخش هم‌زمان، ابطال نشست، هدف‌گیری
 * نوتیفیکیشن» — and this endpoint is where the first two become visible to the
 * person who owns them. The cap is a property of the *tier*, so it is read from
 * the subscription rather than hard-coded: someone who upgrades to خانواده
 * should not have to ask why their fourth device is still refused.
 */

export async function GET(req: Request) {
  const auth = await requireUser(req);
  if (auth.response) return auth.response;
  const { user } = auth;

  /* Which row is *this* browser. Marked so the revoke button can warn that
     pressing it signs you out of the page you are pressing it on. */
  const current = (await cookies()).get(SESSION_COOKIE)?.value;
  const currentDeviceId = db.sessions.find((s) => s.refreshToken === current)?.deviceId;

  const sub = activeSubscription(user.id);
  const cap = sub ? tierSpec(sub.tier).concurrentDevices : 1;

  const devices = db.devices
    .filter((d) => d.userId === user.id)
    .sort((a, b) => Date.parse(b.lastSeenAt) - Date.parse(a.lastSeenAt))
    .map((d) => ({ ...d, current: d.id === currentDeviceId }));

  return Response.json({
    devices,
    concurrentCap: cap,
    /* Named for what it is. Without a subscription the cap is the free-tier
       one, and saying so beats showing "۱" with no explanation. */
    capSource: sub ? tierSpec(sub.tier).name : "بدون اشتراک",
    upgradeTo: TIERS.filter((t) => t.concurrentDevices > cap).map((t) => ({
      id: t.id,
      name: t.name,
      concurrentDevices: t.concurrentDevices,
    })),
  });
}

/**
 * Revoke a device.
 *
 * Deletes the *session* as well as the device row, which is the point: the spec
 * chose an opaque refresh token held in the database specifically so a lost
 * phone can be cut off before its token expires. Removing only the device row
 * would leave a working token behind and make this button a lie.
 */
export async function DELETE(req: Request) {
  const auth = await requireUser(req);
  if (auth.response) return auth.response;
  const { user } = auth;

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return Response.json({ error: "missing_id" }, { status: 422 });

  const device = db.devices.find((d) => d.id === id && d.userId === user.id);
  if (!device) return Response.json({ error: "unknown_device" }, { status: 404 });

  db.sessions = db.sessions.filter((s) => s.deviceId !== id);
  db.devices = db.devices.filter((d) => d.id !== id);

  const current = (await cookies()).get(SESSION_COOKIE)?.value;
  const revokedSelf = !db.sessions.some((s) => s.refreshToken === current);

  const res = Response.json({ ok: true, revokedSelf });
  if (revokedSelf) {
    res.headers.append(
      "set-cookie",
      `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
    );
  }
  return res;
}
