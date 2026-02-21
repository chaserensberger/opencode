---
name: wingman
description: Concise guide for using Wingman (Go SDK + HTTP server) to build agent-powered apps.
---

# Wingman Skill

Wingman is a Go-based agent orchestration framework. Use the Go SDK for maximum control or the HTTP server for batteries-included persistence and REST access.

## When to Use This Skill

Use this skill when you need to:

- Build apps that run LLM agents with tools, sessions, and provider configs
- Choose between the Go SDK (embedded) and the HTTP server (service)
- Wire providers (Anthropic, Ollama, etc.) with typed configs

## Quick Start: Go SDK

Install:

```bash
go get github.com/chaserensberger/wingman
```

Minimal flow:

```go
package main

import (
    "context"
    "log"

    "wingman/agent"
    "wingman/provider/anthropic"
    "wingman/session"
    "wingman/tool"
)

func main() {
    p := anthropic.New(anthropic.Config{Model: "claude-sonnet-4-5"})

    a := agent.New("Assistant",
        agent.WithInstructions("You are helpful."),
        agent.WithProvider(p),
        agent.WithTools(tool.NewBashTool()),
    )

    s := session.New(session.WithAgent(a))
    result, err := s.Run(context.Background(), "What OS am I using?")
    if err != nil {
        log.Fatal(err)
    }

    log.Println(result.Response)
}
```

Notes:

- Providers are typed; each provider has its own `Config`.
- Tools are first-class (`tool.NewBashTool()`, `tool.NewReadTool()`, etc.).
- For concurrency, use `actor.NewFleet` (see SDK docs).

## Quick Start: HTTP Server

Start the server:

```bash
wingman serve
```

Configure provider auth:

```bash
curl -X PUT http://localhost:2323/provider/auth \
  -H "Content-Type: application/json" \
  -d '{"providers": {"anthropic": {"type": "api_key", "key": "sk-ant-..."}}}'
```

Create agent, session, and send message:

```bash
curl -X POST http://localhost:2323/agents \
  -d '{"name":"Assistant","instructions":"Be helpful","tools":["bash"],"provider":{"id":"anthropic","model":"claude-sonnet-4-5","max_tokens":4096}}'

curl -X POST http://localhost:2323/sessions \
  -d '{"work_dir":"/tmp"}'

curl -X POST http://localhost:2323/sessions/SESSION_ID/message \
  -d '{"agent_id":"AGENT_ID","message":"What OS am I on?"}'
```

Streaming:

```bash
curl -X POST http://localhost:2323/sessions/SESSION_ID/message/stream \
  -H "Content-Type: application/json" \
  -d '{"agent_id":"AGENT_ID","message":"Hello"}'
```

Events: `text`, `tool_use`, `tool_result`, `done`, `error`.

## References

- Docs index: `resources/docs/introduction.md`
- SDK details: `resources/docs/sdk.md`
- Server routes: `resources/docs/server.md`
- Providers: `resources/docs/providers.md`

## Practical Guidance for Agents

- Prefer SDK when embedding Wingman in a Go app or you need custom storage.
- Prefer Server when you want persistence + REST access from any language.
- If the server binary is unavailable, fall back to SDK usage.
