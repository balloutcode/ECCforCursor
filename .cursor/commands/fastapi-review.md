---
description: Review a FastAPI application for architecture, async correctness, dependency injection, Pydantic schemas, security, performance, and testability.
---

# FastAPI Review

Invoke the `ecc-fastapi-reviewer` agent (`.cursor/agents/ecc-fastapi-reviewer.md`) for a focused FastAPI review.

## Usage

```text
/fastapi-review [file-or-directory]
```

## Review Areas

- App factory, router boundaries, middleware, and exception handlers.
- Pydantic request and response schema separation.
- Dependency injection for database sessions, auth, pagination, and settings.
- Async database and external HTTP patterns.
- CORS, auth, rate limits, logging, and secret handling.
- OpenAPI metadata and documented response models.
- Test client setup and dependency overrides.

## Expected Output

```text
[SEVERITY] Short issue title
File: path/to/file.py:42
Issue: What is wrong and why it matters.
Fix: Concrete change to make.
```

## Related

- Agent: `ecc-fastapi-reviewer` (`.cursor/agents/ecc-fastapi-reviewer.md`)
- Skill: `fastapi-patterns`
- Command: `/python-review`
- Skill: `security-scan`
