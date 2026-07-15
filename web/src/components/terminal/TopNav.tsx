import Link from "next/link";
import Image from "next/image";
import { auth, signOut } from "@/auth";
import { Pill } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

export async function TopNav({
  variant = "marketing",
}: {
  variant?: "marketing" | "app";
}) {
  let user: { name?: string | null; email?: string | null; image?: string | null } | null = null;
  try {
    const session = await auth();
    user = session?.user ?? null;
  } catch {
    // auth not yet configured (missing GOOGLE_CLIENT_ID / AUTH_SECRET)
  }

  return (
    <header
      className={cn(
        "sticky top-0 z-40 w-full border-b border-graphite/80 bg-void/70 backdrop-blur-xl",
        "[box-shadow:var(--shadow-subtle)]",
      )}
    >
      <div className="mx-auto flex h-14 max-w-[1400px] items-center justify-between px-5">
        <Link href="/" className="flex items-center gap-2.5">
          <Logo />
          <span className="text-body font-medium tracking-tight text-bone">
            AICOS
          </span>
          <span className="hidden text-caption text-mute sm:inline">
            Investment Committee OS
          </span>
        </Link>

        {variant === "marketing" ? (
          <nav className="hidden items-center gap-7 md:flex">
            <NavLink href="#committee">Committee</NavLink>
            <NavLink href="#terminal">Terminal</NavLink>
            <NavLink href="#process">Process</NavLink>
          </nav>
        ) : (
          <nav className="hidden items-center gap-7 md:flex">
            <NavLink href="/terminal">Terminal</NavLink>
            <NavLink href="/terminal">Portfolio</NavLink>
            <NavLink href="/terminal">Research</NavLink>
          </nav>
        )}

        <div className="flex items-center gap-3">
          {variant === "marketing" ? (
            <>
              {user ? (
                <UserChip user={user} />
              ) : (
                <>
                  <Link
                    href="/login"
                    className="hidden text-body-sm text-bone hover:text-lilac sm:inline"
                  >
                    Log in
                  </Link>
                  <Pill href="/terminal" arrow>
                    Launch Terminal
                  </Pill>
                </>
              )}
            </>
          ) : (
            <>
              <span className="mono hidden text-caption text-ash lg:inline">
                MKT OPEN · 14:32 ET
              </span>
              {user ? (
                <UserChip user={user} />
              ) : (
                <Pill href="/login">Sign in</Pill>
              )}
            </>
          )}
        </div>
      </div>
    </header>
  );
}

function UserChip({ user }: { user: { name?: string | null; email?: string | null; image?: string | null } }) {
  const initials = user.name
    ? user.name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase()
    : (user.email?.[0] ?? "?").toUpperCase();

  return (
    <div className="flex items-center gap-2">
      <div className="grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-pill border border-graphite bg-smoke">
        {user.image ? (
          <Image
            src={user.image}
            alt={user.name ?? "User"}
            width={32}
            height={32}
            className="h-full w-full object-cover"
          />
        ) : (
          <span className="mono text-caption text-frost">{initials}</span>
        )}
      </div>
      <form
        action={async () => {
          "use server";
          await signOut({ redirectTo: "/" });
        }}
      >
        <button
          type="submit"
          className="hidden text-caption text-mute transition-colors hover:text-ash sm:inline"
        >
          Sign out
        </button>
      </form>
    </div>
  );
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="text-body-sm text-ash transition-colors hover:text-bone"
    >
      {children}
    </Link>
  );
}

function Logo() {
  // Mercury concentric-circle mark: specialist orbits resolving to a cobalt core.
  return (
    <span className="grid h-7 w-7 place-items-center rounded-icons">
      <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none">
        <circle cx="12" cy="12" r="10" stroke="#ededf3" strokeOpacity="0.35" strokeWidth="1" />
        <circle cx="12" cy="12" r="6" stroke="#ededf3" strokeOpacity="0.55" strokeWidth="1" />
        <circle cx="12" cy="12" r="2.4" fill="#5266eb" />
      </svg>
    </span>
  );
}
