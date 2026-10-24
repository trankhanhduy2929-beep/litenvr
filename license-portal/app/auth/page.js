import AuthClient from "./AuthClient";

export default async function AuthPage({ searchParams }) {
  const params = await searchParams;
  const raw = typeof params?.next === "string" ? params.next : "";
  const next = raw.startsWith("/") && !raw.startsWith("//") ? raw : "/account";
  return <AuthClient next={next} />;
}
