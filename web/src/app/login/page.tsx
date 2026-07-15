import { signIn } from "@/auth";
import { HoloPlane } from "@/components/marketing/HoloPlane";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sign in — AICOS" };

export default function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  return (
    <div className="grid min-h-screen place-items-center bg-void px-4">
      <div className="w-full max-w-sm space-y-8 text-center">
        {/* Logo mark */}
        <div className="mx-auto flex h-16 w-16 items-center justify-center">
          <HoloPlane className="h-16 w-16" />
        </div>

        {/* Wordmark */}
        <div className="space-y-2">
          <h1 className="display text-heading-lg text-bone">AICOS</h1>
          <p className="text-body-sm text-ash">AI Investment Committee OS</p>
        </div>

        {/* Sign in card */}
        <div className="rounded-cards border border-graphite bg-carbon/80 p-8 backdrop-blur-sm glass-edge">
          <p className="mb-6 text-body-sm text-ash">
            Sign in to access the terminal and your committee.
          </p>

          <form
            action={async () => {
              "use server";
              const params = await searchParams;
              await signIn("google", {
                redirectTo: params.callbackUrl ?? "/terminal",
              });
            }}
          >
            <button
              type="submit"
              className="flex w-full items-center justify-center gap-3 rounded-cards border border-graphite bg-smoke px-5 py-3 text-body-sm font-medium text-bone transition-colors hover:border-ash/60 hover:bg-smoke/80"
            >
              <GoogleIcon />
              Continue with Google
            </button>
          </form>
        </div>

        <p className="text-caption text-mute">
          For institutional research and decision support only.
          <br />
          Not investment advice.
        </p>
      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        fill="#EA4335"
      />
    </svg>
  );
}
