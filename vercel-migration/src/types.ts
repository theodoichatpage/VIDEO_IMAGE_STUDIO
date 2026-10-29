export type ImageState = 'waiting' | 'queued' | 'generating' | 'complete' | 'error' | 'stopped';
export type ImageResult = { url: string; prompt: string; createdAt: number; jobId?: string };
export type Scene = { title: string; backdrop: string; content: string; character: string; emotion: string; shot: string; image: string; prompt: string; imageStatus?: ImageState; imageResults?: ImageResult[]; imagePrompt?: string; imageError?: string };
export type PartStatus = 'pending' | 'ready' | 'processing' | 'complete' | 'error' | 'stopped';
export type Part = { id: string; title: string; range: string; content: string; status: PartStatus; scenes: Scene[]; analysisText: string; receivedAt?: number };
export type Job = { id: string; type: 'script_structure' | 'part_analysis' | 'image_generation'; status: string; prompt: string; partId?: string; sceneKey?: string; lane?: string };
export type Session = { id: string; workEpoch?: number; finishedJobIds?: string[]; script: string; status: string; activeJob?: Job | null; lastJob?: Job; parts?: Part[]; bridgeLastSeen?: number; lastError?: string; updatedAt?: number; analysisQueue?: string[]; batchAnalysis?: boolean; stylePrompt?: string; laneJobs?: Job[] };
