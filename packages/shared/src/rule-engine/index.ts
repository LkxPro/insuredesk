/**
 * The SLA rule-engine (issue #47): a pure in-process deep module owning the
 * canonical SLAPolicy structure, its validation, ticket time derivation,
 * read-time alert evaluation, and every human-readable policy description.
 * It takes explicit clocks, ticket times, and comment summaries — never a
 * database, transport, or the current user; those live in the adapters
 * (services, tRPC routers, React forms) around it.
 */

export * from "./derive";
export * from "./describe";
export * from "./evaluate";
export * from "./policy";
export * from "./validate";
