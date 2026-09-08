// 릴레이 회귀 검사.
// 채널 이름이 서로 달라도 명령과 응답이 오가야 하고, /status 가 플러그인/하네스를 구분해야 한다.
const PORT = Number(process.argv[2] || 3157);
const URL = `ws://127.0.0.1:${PORT}`;

function open(channel, headers) {
  return new Promise((resolve, reject) => {
    const ws = headers ? new WebSocket(URL, { headers }) : new WebSocket(URL);
    const seen = [];
    ws.addEventListener("message", (e) => seen.push(JSON.parse(e.data)));
    ws.addEventListener("error", reject);
    ws.addEventListener("open", () => {
      ws.send(JSON.stringify({ type: "join", channel, id: channel + "-join" }));
      setTimeout(() => resolve({ ws, seen }), 300);
    });
    setTimeout(() => reject(new Error("timeout: " + channel)), 5000);
  });
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function fail(reason) {
  console.log("RELAY-FAIL " + reason);
  process.exit(1);
}

try {
  const harness = await open("figma", null);
  const plugin = await open("random-9xk", { origin: "null" });

  harness.ws.send(JSON.stringify({
    type: "message",
    channel: "figma",
    message: { id: "cmd1", command: "get_document_info" },
  }));
  await wait(400);
  const gotCommand = plugin.seen.some(
    (m) => m.type === "broadcast" && m.message?.command === "get_document_info" && m.channel === "random-9xk"
  );
  if (!gotCommand) fail("plugin-did-not-receive-command");

  plugin.ws.send(JSON.stringify({
    type: "message",
    channel: "random-9xk",
    message: { id: "cmd1", result: { name: "MyFile" } },
  }));
  await wait(400);
  const gotResult = harness.seen.some(
    (m) => m.type === "broadcast" && m.message?.result?.name === "MyFile" && m.channel === "figma"
  );
  if (!gotResult) fail("harness-did-not-receive-result");

  const status = await (await fetch(`http://127.0.0.1:${PORT}/status`)).json();
  if (status.relay !== "figma-bridge") fail("status-not-ours");
  if (status.figmaJoined !== 1) fail("status-figma-count:" + status.figmaJoined);
  if (status.harnessJoined !== 1) fail("status-harness-count:" + status.harnessJoined);
  if (!status.ready) fail("status-not-ready");

  console.log("RELAY-OK");
  process.exit(0);
} catch (err) {
  fail("exception:" + err.message);
}
