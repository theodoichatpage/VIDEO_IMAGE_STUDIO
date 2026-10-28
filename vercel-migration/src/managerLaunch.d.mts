export interface ManagerLaunch { projectId: string | null; runId: string | null; error: string; }
export function resolveManagerLaunch(storage: Pick<Storage, "getItem" | "setItem">, search: string): ManagerLaunch;
