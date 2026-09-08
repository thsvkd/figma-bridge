#!/usr/bin/env bun
// figma-bridge 릴레이.
// cursor-talk-to-figma-socket 과 같은 프로토콜(join / message / progress_update)을 쓰되,
// 두 가지를 더한다.
//   1) 채널 브리지 — 플러그인이 랜덤 채널로 들어와도 하네스와 서로 통한다.
//      (사용자가 채널 이름을 읽어서 AI에게 불러줄 필요가 없어진다.)
//   2) GET /status — GUI 가 "피그마 플러그인이 실제로 붙었는지"를 확인한다.

import { appendFileSync } from "node:fs";

const PORT = Number(process.env.FIGMA_BRIDGE_PORT || 3055);
const LOG_PATH = process.env.FIGMA_BRIDGE_LOG || "";
const STARTED_AT = new Date().toISOString();

// 콘솔 창 없이 뜨기 때문에 로그는 직접 파일에 남긴다.
function log(line) {
  console.log(line);
  if (!LOG_PATH) return;
  try {
    appendFileSync(LOG_PATH, new Date().toISOString() + "  " + line + "\n");
  } catch {}
}

// ws -> { kind: "figma" | "harness", channel: string | null, joinedAt: string | null }
const clients = new Map();

function clientKind(req) {
  // 피그마 플러그인 UI 는 브라우저 컨텍스트라 Origin 을 보낸다(대개 "null").
  // 하네스(MCP)의 node/bun ws 클라이언트는 Origin 도 User-Agent 도 보내지 않는다.
  const origin = req.headers.get("origin");
  const ua = req.headers.get("user-agent") || "";
  if (origin !== null || /figma|electron|mozilla/i.test(ua)) return "figma";
  return "harness";
}

function info(ws) {
  return clients.get(ws) || null;
}

function joinedPeers(exclude) {
  const out = [];
  for (const [ws, meta] of clients) {
    if (ws === exclude) continue;
    if (!meta.channel) continue;
    if (ws.readyState !== 1) continue;
    out.push([ws, meta]);
  }
  return out;
}

function statusPayload() {
  const channels = new Set();
  let figma = 0;
  let harness = 0;
  let figmaJoined = 0;
  let harnessJoined = 0;
  for (const meta of clients.values()) {
    if (meta.channel) channels.add(meta.channel);
    if (meta.kind === "figma") {
      figma++;
      if (meta.channel) figmaJoined++;
    } else {
      harness++;
      if (meta.channel) harnessJoined++;
    }
  }
  return {
    relay: "figma-bridge",
    ok: true,
    port: PORT,
    startedAt: STARTED_AT,
    bridged: true,
    clients: clients.size,
    figma,
    harness,
    figmaJoined,
    harnessJoined,
    ready: figmaJoined > 0 && harnessJoined > 0,
    channels: [...channels],
  };
}

function send(ws, obj) {
  try {
    ws.send(JSON.stringify(obj));
  } catch (err) {
    log("send failed: " + err);
  }
}

const server = Bun.serve({
  port: PORT,
  fetch(req, srv) {
    const url = new URL(req.url);

    if (req.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
        },
      });
    }

    const upgraded = srv.upgrade(req, {
      data: { kind: clientKind(req) },
      headers: { "Access-Control-Allow-Origin": "*" },
    });
    if (upgraded) return;

    if (url.pathname === "/status") {
      return Response.json(statusPayload(), {
        headers: { "Access-Control-Allow-Origin": "*" },
      });
    }

    // 기존 소켓 서버와 같은 본문. 상태 점검이 이 문자열을 본다.
    return new Response("WebSocket server running", {
      headers: { "Access-Control-Allow-Origin": "*" },
    });
  },
  websocket: {
    open(ws) {
      const kind = ws.data?.kind === "figma" ? "figma" : "harness";
      clients.set(ws, { kind, channel: null, joinedAt: null });
      log(`New client connected (${kind}, total ${clients.size})`);
      send(ws, { type: "system", message: "Please join a channel to start chatting" });
    },

    message(ws, raw) {
      let data;
      try {
        data = JSON.parse(raw);
      } catch (err) {
        log("Error parsing message: " + err);
        return;
      }
      const meta = info(ws);
      if (!meta) return;

      if (data.type === "join") {
        const channel = data.channel;
        if (!channel || typeof channel !== "string") {
          send(ws, { type: "error", message: "Channel name is required" });
          return;
        }
        meta.channel = channel;
        meta.joinedAt = new Date().toISOString();
        log(`Client joined channel "${channel}" (${meta.kind})`);

        send(ws, { type: "system", message: `Joined channel: ${channel}`, channel });
        send(ws, {
          type: "system",
          message: { id: data.id, result: "Connected to channel: " + channel },
          channel,
        });
        for (const [peer, peerMeta] of joinedPeers(ws)) {
          send(peer, {
            type: "system",
            message: "A new user has joined the channel",
            channel: peerMeta.channel,
          });
        }
        return;
      }

      if (data.type === "message") {
        if (!meta.channel) {
          send(ws, { type: "error", message: "You must join the channel first" });
          return;
        }
        const peers = joinedPeers(ws);
        for (const [peer, peerMeta] of peers) {
          // 받는 쪽이 자기 채널로 인식하도록 채널 이름을 바꿔 끼운다.
          send(peer, {
            type: "broadcast",
            message: data.message,
            sender: "peer",
            channel: peerMeta.channel,
          });
        }
        if (peers.length === 0) {
          log(`No peer to receive message from "${meta.channel}"`);
        }
        return;
      }

      if (data.type === "progress_update") {
        if (!meta.channel) return;
        for (const [peer, peerMeta] of joinedPeers(ws)) {
          send(peer, { ...data, channel: peerMeta.channel });
        }
      }
    },

    close(ws) {
      const meta = info(ws);
      clients.delete(ws);
      log(`Client disconnected (${meta ? meta.kind : "unknown"}, total ${clients.size})`);
      for (const [peer, peerMeta] of joinedPeers(null)) {
        send(peer, {
          type: "system",
          message: "A user has left the channel",
          channel: peerMeta.channel,
        });
      }
    },
  },
});

log(`WebSocket server running on port ${server.port}`);
