export interface ManagerLaunch { projectId: string | null; runId: string | null; error: string; lane?: boolean; }
export function resolveManagerLaunch(storage: Pick<Storage, "getItem" | "setItem">, search: string): ManagerLaunch;
