import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

/**
 * Single-user access control (ADR-0005): this app has exactly one intended
 * user, so there is no user table, no roles, and no sign-up — just a Google
 * sign-in gated by an email allowlist of size one. `ALLOWED_GOOGLE_EMAIL` is
 * required; an unset value must fail closed (deny everyone), matching the
 * same fail-closed rule already used for `CRON_SECRET` in
 * src/app/api/jobs/daily-briefing/route.ts.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Google({
      clientId: process.env.CLIENT_ID,
      clientSecret: process.env.CLIENT_PASSWORD,
    }),
  ],
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  callbacks: {
    async signIn({ profile }) {
      const allowedEmail = process.env.ALLOWED_GOOGLE_EMAIL;
      if (!allowedEmail) return false;
      return profile?.email === allowedEmail;
    },
  },
});
