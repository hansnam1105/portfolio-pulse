import { signIn } from "@/auth";

/**
 * Custom sign-in page (ADR-0005), replacing Auth.js's built-in one: that
 * default page loads its provider icon from an external CDN, which the
 * app's own strict `img-src 'self' data:` CSP (src/middleware.ts) blocks.
 * A plain server-action form has no client-side script or external asset of
 * its own to trip over.
 */
export default function LoginPage() {
  return (
    <div className="app-shell" style={{ justifyContent: "center", alignItems: "center" }}>
      <form
        action={async () => {
          "use server";
          await signIn("google", { redirectTo: "/" });
        }}
      >
        <button type="submit" className="btn btn--primary">
          Google로 로그인
        </button>
      </form>
    </div>
  );
}
