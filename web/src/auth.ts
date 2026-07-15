import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [Google],
  pages: {
    signIn: "/login",
  },
  callbacks: {
    authorized({ auth: session, request: { nextUrl } }) {
      // Self-healing gate: only guard /terminal when Google OAuth is actually
      // configured. With no GOOGLE_CLIENT_ID there is no way to sign in, so
      // locking the terminal would make it unreachable — leave it open until
      // credentials are added, then the gate re-engages automatically.
      const googleConfigured = !!process.env.GOOGLE_CLIENT_ID;
      const isLoggedIn = !!session?.user;
      const isTerminal = nextUrl.pathname.startsWith("/terminal");
      if (isTerminal && googleConfigured && !isLoggedIn) return false;
      return true;
    },
  },
});
