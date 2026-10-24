import SuccessClient from "./SuccessClient";

export default async function SuccessPage({ searchParams }) {
  const params = await searchParams;
  const code = params?.orderCode ?? params?.order_code ?? params?.code ?? "";
  return <SuccessClient code={String(code)} />;
}
