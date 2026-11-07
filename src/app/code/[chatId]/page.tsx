import { CodeWorkspace } from "./workspace";

export const metadata = { title: "Senko Workspace" };

// Full-page project workspace for one chat. This route is cross-origin isolated (see
// next.config.mjs) so Node.js can run in the browser here.
export default async function Page({ params }: { params: Promise<{ chatId: string }> }) {
  const { chatId } = await params;
  return <CodeWorkspace chatId={decodeURIComponent(chatId)} />;
}
