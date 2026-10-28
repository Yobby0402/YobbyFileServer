import { useCallback, useEffect, useState } from "react"
import { PCBViewer } from "@tscircuit/pcb-viewer"
import {
  convertDsnSessionToCircuitJson,
  DsnPcb,
  DsnSession,
  parseDsnToCircuitJson,
  parseDsnToDsnJson,
} from "dsn-converter"

const fileUrl = new URLSearchParams(window.location.search).get("file")

function App() {
  const [circuitJson, setCircuitJson] = useState<any>(null)
  const [inSessionMode, setInSessionMode] = useState(false)
  const [sessionFile, setSessionFile] = useState<string | null>(null)
  const [dsnPcbFile, setDsnPcbFile] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(Boolean(fileUrl))

  const processFile = useCallback((content: string) => {
    setError(null)

    try {
      if (!inSessionMode) {
        setCircuitJson(parseDsnToCircuitJson(content))
        return
      }

      if (content.trim().startsWith("(pcb")) {
        setDsnPcbFile(content)
      } else if (content.trim().startsWith("(session")) {
        setSessionFile(content)
      } else {
        setError("文件不是有效的 DSN PCB 或 session 文件。")
        return
      }

      const updatedSession = content.trim().startsWith("(session") ? content : sessionFile
      const updatedPcb = content.trim().startsWith("(pcb") ? content : dsnPcbFile
      if (updatedSession && updatedPcb) {
        const dsnPcb = parseDsnToDsnJson(updatedPcb) as DsnPcb
        const dsnSession = parseDsnToDsnJson(updatedSession) as DsnSession
        setCircuitJson(convertDsnSessionToCircuitJson(dsnPcb, dsnSession))
      }
    } catch (cause) {
      console.error("Unable to parse DSN file", cause)
      setError("无法解析该 DSN 文件，请检查文件格式。")
    }
  }, [dsnPcbFile, inSessionMode, sessionFile])

  useEffect(() => {
    if (!fileUrl) return

    fetch(fileUrl)
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        processFile(await response.text())
      })
      .catch((cause) => {
        console.error("Unable to load DSN file", cause)
        setError("无法读取服务器上的 DSN 文件。")
      })
      .finally(() => setLoading(false))
  }, [processFile])

  const handleDrop = useCallback((event: React.DragEvent) => {
    event.preventDefault()
    const [file] = Array.from(event.dataTransfer.files)
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => processFile(String(reader.result || ""))
    reader.readAsText(file)
  }, [processFile])

  if (loading) {
    return <main className="status">正在加载 DSN 文件...</main>
  }

  if (circuitJson) {
    return (
      <main className="viewer-shell" onDrop={handleDrop} onDragOver={(event) => event.preventDefault()}>
        <PCBViewer circuitJson={circuitJson} height={800} />
      </main>
    )
  }

  return (
    <main className="drop-zone" onDrop={handleDrop} onDragOver={(event) => event.preventDefault()}>
      <section>
        <h1>Specctra DSN Viewer</h1>
        {error && <p className="error">{error}</p>}
        {inSessionMode ? (
          <p>请依次拖入 session 文件和 DSN PCB 文件。{sessionFile ? " Session 已加载。" : ""}{dsnPcbFile ? " PCB 已加载。" : ""}</p>
        ) : (
          <p>将 DSN 文件拖到这里以查看 PCB。</p>
        )}
        <button type="button" onClick={() => setInSessionMode((value) => !value)}>
          {inSessionMode ? "使用单个 DSN 文件" : "加载 DSN session"}
        </button>
      </section>
    </main>
  )
}

export default App
