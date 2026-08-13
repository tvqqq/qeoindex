import http from "node:http"

const mode = process.env.MOCK_OUTBOX_MODE ?? "failure"
let notionPage = 0
const server = http.createServer((request, response) => {
  request.resume()
  request.on("end", () => {
    response.setHeader("content-type", "application/json")
    if (mode === "success") {
      if (request.url?.includes("sendMessage")) response.end(JSON.stringify({ ok: true, result: { message_id: 12345 } }))
      else response.end(JSON.stringify({ id: `local-notion-page-${++notionPage}` }))
      return
    }
    response.statusCode = 503
    response.end(JSON.stringify({ ok: false, description: "local simulated failure", message: "local simulated failure" }))
  })
})

server.listen(43119, "0.0.0.0", () => console.log("Mock outbox APIs listening on 43119"))
