import { useEffect, useRef, useState } from "react"

type Status = "idle" | "translating" | "done" | "error" | "wrong-page"

function IndexPopup() {
  const [apiKey, setApiKey] = useState("")
  const [apiProvider, setApiProvider] = useState("deepl")
  const [saved, setSaved] = useState(false)
  const [status, setStatus] = useState<Status>("idle")
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [errorMsg, setErrorMsg] = useState("")
  const listenerRef = useRef<(msg: any) => void>()

  useEffect(() => {
    chrome.storage.sync.get(["apiKey", "apiProvider"], (result) => {
      if (result.apiKey) setApiKey(result.apiKey)
      if (result.apiProvider) setApiProvider(result.apiProvider)
    })

    // 监听来自 content script 的进度消息
    const listener = (message: any) => {
      if (message.type === "TRANSLATION_PROGRESS") {
        setProgress({ done: message.done, total: message.total })
        setStatus("translating")
      } else if (message.type === "TRANSLATION_COMPLETE") {
        setProgress({ done: message.total, total: message.total })
        setStatus("done")
      } else if (message.type === "TRANSLATION_ERROR") {
        setErrorMsg(message.message)
        setStatus("error")
      }
    }
    listenerRef.current = listener
    chrome.runtime.onMessage.addListener(listener)

    return () => {
      chrome.runtime.onMessage.removeListener(listener)
    }
  }, [])

  const handleSave = async () => {
    chrome.storage.sync.set({ apiKey, apiProvider }, () => {
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    })
  }

  const handleTranslate = async () => {
    setStatus("translating")
    setProgress({ done: 0, total: 0 })
    setErrorMsg("")

    const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
    const currentTab = tabs[0]

    if (!currentTab?.id) {
      setErrorMsg("无法获取当前标签页")
      setStatus("error")
      return
    }

    if (!currentTab.url?.includes("news.ycombinator.com")) {
      setStatus("wrong-page")
      return
    }

    try {
      await chrome.tabs.sendMessage(currentTab.id, { type: "TRANSLATE_PAGE" })
    } catch (error) {
      setErrorMsg("无法连接到页面，请刷新后重试")
      setStatus("error")
    }
  }

  const isTranslating = status === "translating"

  return (
    <div
      style={{
        width: "400px",
        padding: "20px",
        fontFamily: "system-ui, -apple-system, sans-serif"
      }}>
      <h2 style={{ margin: "0 0 20px 0", color: "#ff6600" }}>
        🌐 HN Dual 设置
      </h2>

      <div style={{ marginBottom: "16px" }}>
        <label
          style={{
            display: "block",
            marginBottom: "8px",
            fontWeight: "500",
            fontSize: "14px"
          }}>
          翻译服务
        </label>
        <select
          value={apiProvider}
          onChange={(e) => setApiProvider(e.target.value)}
          style={{
            width: "100%",
            padding: "8px",
            borderRadius: "4px",
            border: "1px solid #ddd",
            fontSize: "14px"
          }}>
          <option value="deepl">DeepL (推荐)</option>
          <option value="openai">OpenAI</option>
        </select>
      </div>

      <div style={{ marginBottom: "16px" }}>
        <label
          style={{
            display: "block",
            marginBottom: "8px",
            fontWeight: "500",
            fontSize: "14px"
          }}>
          API Key
        </label>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={
            apiProvider === "deepl"
              ? "输入你的 DeepL API Key"
              : "输入你的 OpenAI API Key"
          }
          style={{
            width: "100%",
            padding: "8px",
            borderRadius: "4px",
            border: "1px solid #ddd",
            fontSize: "14px",
            boxSizing: "border-box"
          }}
        />
        <p
          style={{
            fontSize: "12px",
            color: "#666",
            margin: "4px 0 0 0"
          }}>
          {apiProvider === "deepl" ? (
            <>
              获取 API Key:{" "}
              <a
                href="https://www.deepl.com/pro-api"
                target="_blank"
                style={{ color: "#ff6600" }}>
                deepl.com/pro-api
              </a>
              <br />
              <span style={{ fontSize: "11px", color: "#999" }}>
                支持 Free API (以 :fx 结尾) 和 Pro API
              </span>
            </>
          ) : (
            <>
              获取 API Key:{" "}
              <a
                href="https://platform.openai.com/api-keys"
                target="_blank"
                style={{ color: "#ff6600" }}>
                platform.openai.com
              </a>
            </>
          )}
        </p>
      </div>

      <button
        onClick={handleSave}
        style={{
          width: "100%",
          padding: "10px",
          background: saved ? "#4caf50" : "#ff6600",
          color: "white",
          border: "none",
          borderRadius: "4px",
          fontSize: "14px",
          fontWeight: "500",
          cursor: "pointer",
          transition: "background 0.2s",
          marginBottom: "12px"
        }}>
        {saved ? "✓ 已保存" : "保存设置"}
      </button>

      <button
        onClick={handleTranslate}
        disabled={isTranslating || !apiKey}
        style={{
          width: "100%",
          padding: "10px",
          background: isTranslating ? "#999" : "#0066cc",
          color: "white",
          border: "none",
          borderRadius: "4px",
          fontSize: "14px",
          fontWeight: "500",
          cursor: isTranslating || !apiKey ? "not-allowed" : "pointer",
          transition: "background 0.2s",
          marginBottom: "12px"
        }}>
        {isTranslating ? "翻译中..." : "🌐 翻译当前页面"}
      </button>

      {/* 翻译状态区域 */}
      {status !== "idle" && (
        <div
          style={{
            padding: "12px",
            borderRadius: "4px",
            fontSize: "13px",
            lineHeight: "1.5",
            ...statusStyle(status)
          }}>
          {status === "translating" && (
            <>
              <div style={{ marginBottom: "8px" }}>
                ⏳ 正在翻译...
                {progress.total > 0 && (
                  <span style={{ float: "right", color: "#666" }}>
                    {progress.done} / {progress.total}
                  </span>
                )}
              </div>
              {progress.total > 0 && (
                <div
                  style={{
                    height: "4px",
                    background: "#ddd",
                    borderRadius: "2px",
                    overflow: "hidden"
                  }}>
                  <div
                    style={{
                      height: "100%",
                      width: `${Math.round((progress.done / progress.total) * 100)}%`,
                      background: "#ff6600",
                      borderRadius: "2px",
                      transition: "width 0.3s"
                    }}
                  />
                </div>
              )}
            </>
          )}
          {status === "done" && (
            <span>✓ 翻译完成，共 {progress.total} 条</span>
          )}
          {status === "error" && (
            <span>✗ {errorMsg || "翻译失败，请检查 API Key 配置"}</span>
          )}
          {status === "wrong-page" && (
            <span>请在 Hacker News 页面使用此功能</span>
          )}
        </div>
      )}

      {status === "idle" && (
        <div
          style={{
            padding: "12px",
            background: "#f5f5f5",
            borderRadius: "4px",
            fontSize: "13px",
            lineHeight: "1.6"
          }}>
          <p style={{ margin: "0 0 8px 0", fontWeight: "500" }}>使用说明：</p>
          <ul style={{ margin: 0, paddingLeft: "20px" }}>
            <li>配置 API Key 后，点击"翻译当前页面"按钮</li>
            <li>翻译以段落交替方式显示（原文 + 译文）</li>
            <li>从 HN 打开的外链文章会自动翻译</li>
            <li>翻译结果会自动缓存，节省 API 调用</li>
          </ul>
        </div>
      )}
    </div>
  )
}

function statusStyle(status: Status): React.CSSProperties {
  switch (status) {
    case "translating":
      return { background: "#fff8f0", border: "1px solid #ff6600", color: "#333" }
    case "done":
      return { background: "#f0fff4", border: "1px solid #4caf50", color: "#2e7d32" }
    case "error":
    case "wrong-page":
      return { background: "#fff0f0", border: "1px solid #e53935", color: "#c62828" }
    default:
      return {}
  }
}

export default IndexPopup
