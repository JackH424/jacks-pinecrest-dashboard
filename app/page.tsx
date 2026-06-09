import { getWorkspace, PRIMARY_USER } from "@/lib/data";
import { dbConnected } from "@/lib/db";
import Workspace from "./Workspace";

export const dynamic = "force-dynamic";

export default async function Page() {
  const data = await getWorkspace();
  return <Workspace data={data} primaryUser={PRIMARY_USER} persists={dbConnected()} />;
}
