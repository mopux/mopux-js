import type { components, operations } from './generated/openapi.js';

export type { components, operations, paths } from './generated/openapi.js';

type JsonContent<T> = T extends { content: { 'application/json': infer Body } } ? Body : never;

/** The `data` member of the 200 response of an operation, typed from the OpenAPI spec. */
export type ResponseData<Op extends keyof operations> = operations[Op] extends { responses: { 200: infer Ok } }
  ? JsonContent<Ok> extends { data?: infer Data }
    ? Data
    : never
  : never;

/** JSON request body of an operation. */
export type RequestBody<Op extends keyof operations> = operations[Op] extends { requestBody?: infer Body }
  ? JsonContent<NonNullable<Body>>
  : never;

/** Query parameters of an operation. */
export type QueryParams<Op extends keyof operations> = operations[Op] extends { parameters: { query?: infer Query } }
  ? NonNullable<Query>
  : never;

type Schemas = components['schemas'];

export type AuthenticatedUser = Schemas['AuthenticatedUser'];
export type ApiToken = Schemas['ApiToken'];
export type AuthTokenData = Schemas['AuthTokenData'];
export type ProjectSummary = Schemas['ProjectSummary'];
export type ProjectDetail = Schemas['ProjectDetail'];
export type ProjectBoard = Schemas['ProjectBoard'];
export type ProjectStatus = Schemas['ProjectStatus'];
export type ProjectMember = Schemas['ProjectMember'];
export type ProjectActivity = Schemas['ProjectActivity'];
export type TaskGroup = Schemas['TaskGroup'];
export type TaskGroupBoard = Schemas['TaskGroupBoard'];
export type TaskSummary = Schemas['TaskSummary'];
export type TaskDetail = Schemas['TaskDetail'];
export type TaskBoard = Schemas['TaskBoard'];
export type TaskStatus = Schemas['TaskStatus'];
export type TaskStatusRead = Schemas['TaskStatusRead'];
export type TaskPriority = Schemas['TaskPriority'];
export type AssigneeMutation = Schemas['AssigneeMutation'];
export type TaskCreateInput = Schemas['TaskCreateInput'];
export type TaskUpdateInput = Schemas['TaskUpdateInput'];
export type TaskBatchUpdateInput = Schemas['TaskBatchUpdateInput'];
export type TaskGroupCompoundTask = Schemas['TaskGroupCompoundTask'];
export type Attachment = Schemas['Attachment'];
export type FocusList = Schemas['FocusList'];
export type Comment = Schemas['Comment'];
export type Notification = Schemas['Notification'];
export type Touch = Schemas['Touch'];
export type TeamInvitation = Schemas['TeamInvitation'];
export type UserBrief = Schemas['UserBrief'];

/** Task status values that can be written (`-1`, delayed, is read only). */
export const TaskStatuses = { Pending: 0, InProgress: 1, Review: 2, Done: 3 } as const;
export const TaskPriorities = { Low: 0, Normal: 1, High: 2, Maximum: 9 } as const;
