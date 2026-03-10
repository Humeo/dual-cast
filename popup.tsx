import { useEffect, useRef, useState } from "react"

type TransStatus = "idle" | "translating" | "done" | "stopped" | "error"
type SummaryStatus = "idle" | "summarizing" | "done" | "error"
type Tab = "translate" | "history"

interface HistoryItem {
  url: string
  title: string
  summary: string
  timestamp: number
}

function formatTime(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 60_000) return "刚刚"
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  return `${Math.floor(diff / 86_400_000)} 天前`
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  borderRadius: "8px",
  border: "1px solid #e5e7eb",
  fontSize: "12px",
  boxSizing: "border-box",
  outline: "none",
  background: "#fafafa",
  color: "#111827",
  fontFamily: "inherit",
}

const labelStyle: React.CSSProperties = {
  display: "block",
  marginBottom: "5px",
  fontWeight: "600",
  fontSize: "11px",
  color: "#6b7280",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
}

function IndexPopup() {
  const [activeTab, setActiveTab] = useState<Tab>("translate")
  const [settingsOpen, setSettingsOpen] = useState(false)

  // 设置
  const [apiKey, setApiKey] = useState("")
  const [apiProvider, setApiProvider] = useState("deepl")
  const [openaiKeyForSummary, setOpenaiKeyForSummary] = useState("")
  const [apiBaseUrl, setApiBaseUrl] = useState("")
  const [apiModel, setApiModel] = useState("")
  const [saved, setSaved] = useState(false)
  const [showTranslations, setShowTranslations] = useState(true)

  // 翻译状态
  const [transStatus, setTransStatus] = useState<TransStatus>("idle")
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [transError, setTransError] = useState("")

  // 总结状态
  const [summaryStatus, setSummaryStatus] = useState<SummaryStatus>("idle")
  const [summary, setSummary] = useState("")
  const [summaryError, setSummaryError] = useState("")

  // 历史记录
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null)

  const listenerRef = useRef<(msg: any) => void>()

  useEffect(() => {
    chrome.storage.local.get(
      ["apiKey", "apiProvider", "openaiKeyForSummary", "apiBaseUrl", "apiModel", "showTranslations", "summaryHistory"],
      (result) => {
        if (result.apiKey) setApiKey(result.apiKey)
        if (result.apiProvider) setApiProvider(result.apiProvider)
        if (result.openaiKeyForSummary) setOpenaiKeyForSummary(result.openaiKeyForSummary)
        if (result.apiBaseUrl) setApiBaseUrl(result.apiBaseUrl)
        if (result.apiModel) setApiModel(result.apiModel)
        setShowTranslations(result.showTranslations !== false)
        setHistory(result.summaryHistory || [])
        if (!result.apiKey) setSettingsOpen(true)
      }
    )

    const listener = (message: any) => {
      if (message.type === "TRANSLATION_PROGRESS") {
        setProgress({ done: message.done, total: message.total })
        setTransStatus("translating")
      } else if (message.type === "TRANSLATION_COMPLETE") {
        setProgress({ done: message.total, total: message.total })
        setTransStatus("done")
      } else if (message.type === "TRANSLATION_STOPPED") {
        setTransStatus("stopped")
      } else if (message.type === "TRANSLATION_ERROR") {
        setTransError(message.message)
        setTransStatus("error")
      }
    }
    listenerRef.current = listener
    chrome.runtime.onMessage.addListener(listener)
    return () => chrome.runtime.onMessage.removeListener(listener)
  }, [])

  const handleSave = () => {
    chrome.storage.local.set({ apiKey, apiProvider, openaiKeyForSummary, apiBaseUrl, apiModel }, () => {
      setSaved(true)
      setTimeout(() => { setSaved(false); setSettingsOpen(false) }, 1200)
    })
  }

  const handleTranslate = async () => {
    setTransStatus("translating")
    setProgress({ done: 0, total: 0 })
    setTransError("")
    setSummaryStatus("idle")

    const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!tabs[0]?.id) { setTransError("无法获取当前标签页"); setTransStatus("error"); return }
    try {
      await chrome.tabs.sendMessage(tabs[0].id, { type: "TRANSLATE_PAGE" })
    } catch {
      setTransError("无法连接到页面，请刷新后重试")
      setTransStatus("error")
    }
  }

  const handleStop = async () => {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
    if (tabs[0]?.id) chrome.tabs.sendMessage(tabs[0].id, { type: "STOP_TRANSLATION" }).catch(() => {})
  }

  const handleToggleVisibility = async () => {
    const next = !showTranslations
    setShowTranslations(next)
    chrome.storage.local.set({ showTranslations: next })
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
    if (tabs[0]?.id) chrome.tabs.sendMessage(tabs[0].id, { type: "TOGGLE_TRANSLATIONS", show: next }).catch(() => {})
  }

  const handleSummarize = async () => {
    setSummaryStatus("summarizing")
    setSummary("")
    setSummaryError("")
    setTransStatus("idle")

    const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
    const tab = tabs[0]
    if (!tab?.id) { setSummaryError("无法获取当前标签页"); setSummaryStatus("error"); return }

    let articleData: { title: string; text: string } | null = null
    try {
      articleData = await chrome.tabs.sendMessage(tab.id, { type: "GET_ARTICLE_TEXT" })
    } catch {
      setSummaryError("无法连接到页面，请刷新后重试")
      setSummaryStatus("error")
      return
    }

    if (!articleData?.text) {
      setSummaryError("未检测到可总结的文章内容")
      setSummaryStatus("error")
      return
    }

    const response = await chrome.runtime.sendMessage({
      type: "SUMMARIZE",
      text: articleData.text,
      title: articleData.title
    })

    if (response.error) {
      setSummaryError(response.error)
      setSummaryStatus("error")
      return
    }

    setSummary(response.summary)
    setSummaryStatus("done")

    const newItem: HistoryItem = {
      url: tab.url || "",
      title: articleData.title,
      summary: response.summary,
      timestamp: Date.now()
    }
    chrome.storage.local.get(["summaryHistory"], (stored) => {
      const updated = [newItem, ...(stored.summaryHistory || [])].slice(0, 100)
      chrome.storage.local.set({ summaryHistory: updated })
      setHistory(updated)
    })
  }

  const handleClearHistory = () => {
    chrome.storage.local.set({ summaryHistory: [] })
    setHistory([])
    setExpandedIndex(null)
  }

  const isTranslating = transStatus === "translating"
  const isSummarizing = summaryStatus === "summarizing"
  const hasApiKey = !!apiKey
  const hasSummaryKey = !!(apiKey || openaiKeyForSummary)

  return (
    <div style={{ width: "380px", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', sans-serif", background: "#f3f4f6" }}>

      {/* ── Header ── */}
      <div style={{
        background: "linear-gradient(135deg, #ff5500 0%, #ff8c00 100%)",
        padding: "14px 16px 12px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <div style={{
            width: "34px", height: "34px", borderRadius: "10px",
            background: "rgba(255,255,255,0.2)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: "18px",
          }}>🌐</div>
          <div>
            <div style={{ color: "white", fontWeight: "700", fontSize: "15px", letterSpacing: "-0.3px" }}>HN Dual</div>
            <div style={{ color: "rgba(255,255,255,0.75)", fontSize: "11px" }}>双语阅读 · AI 摘要</div>
          </div>
        </div>
        <button
          onClick={() => setSettingsOpen(!settingsOpen)}
          style={{
            background: settingsOpen ? "rgba(255,255,255,0.28)" : "rgba(255,255,255,0.15)",
            border: "1px solid rgba(255,255,255,0.35)",
            borderRadius: "8px",
            color: "white",
            padding: "6px 11px",
            cursor: "pointer",
            fontSize: "12px",
            fontWeight: "500",
            display: "flex",
            alignItems: "center",
            gap: "5px",
            transition: "background 0.15s",
            fontFamily: "inherit",
          }}>
          <span style={{ fontSize: "13px" }}>⚙️</span>
          {hasApiKey ? "设置" : <span style={{ color: "#fde68a" }}>未配置</span>}
        </button>
      </div>

      {/* ── Settings Panel ── */}
      {settingsOpen && (
        <div style={{
          background: "white",
          borderBottom: "1px solid #e5e7eb",
          padding: "16px",
        }}>
          {/* Provider toggle */}
          <div style={{ marginBottom: "14px" }}>
            <label style={labelStyle}>翻译服务</label>
            <div style={{ display: "flex", gap: "8px" }}>
              {([
                { value: "deepl", icon: "🔵", name: "DeepL", badge: "推荐" },
                { value: "openai", icon: "🤖", name: "OpenAI", badge: "" },
              ] as const).map((p) => (
                <button
                  key={p.value}
                  onClick={() => setApiProvider(p.value)}
                  style={{
                    flex: 1,
                    padding: "8px 10px",
                    border: apiProvider === p.value ? "2px solid #ff6600" : "2px solid #e5e7eb",
                    borderRadius: "8px",
                    background: apiProvider === p.value ? "#fff8f0" : "#fafafa",
                    color: apiProvider === p.value ? "#c2410c" : "#6b7280",
                    fontWeight: apiProvider === p.value ? "600" : "400",
                    fontSize: "12px",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "5px",
                    fontFamily: "inherit",
                    transition: "all 0.15s",
                  }}>
                  {p.icon} {p.name}
                  {p.badge && (
                    <span style={{
                      fontSize: "9px", background: "#ff6600", color: "white",
                      borderRadius: "4px", padding: "1px 4px", fontWeight: "700"
                    }}>{p.badge}</span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Translation API Key */}
          <div style={{ marginBottom: "12px" }}>
            <label style={labelStyle}>
              {apiProvider === "deepl" ? "DeepL API Key" : "OpenAI API Key"}
            </label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={apiProvider === "deepl" ? "以 :fx 结尾为免费版" : "sk-..."}
              style={inputStyle}
            />
            {apiProvider === "deepl" && (
              <p style={{ margin: "4px 0 0", fontSize: "11px", color: "#9ca3af" }}>
                <a href="https://www.deepl.com/pro-api" target="_blank"
                  style={{ color: "#ff6600", textDecoration: "none" }}>deepl.com/pro-api</a>
                {" "}获取免费 API Key
              </p>
            )}
          </div>

          {/* OpenAI key for summary (DeepL users) */}
          {apiProvider === "deepl" && (
            <div style={{ marginBottom: "12px" }}>
              <label style={labelStyle}>
                OpenAI Key{" "}
                <span style={{ color: "#d1d5db", fontWeight: "400", textTransform: "none", letterSpacing: 0 }}>（AI 摘要专用，选填）</span>
              </label>
              <input
                type="password"
                value={openaiKeyForSummary}
                onChange={(e) => setOpenaiKeyForSummary(e.target.value)}
                placeholder="sk-..."
                style={inputStyle}
              />
            </div>
          )}

          {/* Custom endpoint + model */}
          <div style={{ display: "flex", gap: "8px", marginBottom: "14px" }}>
            <div style={{ flex: 3 }}>
              <label style={labelStyle}>API 地址 <span style={{ color: "#d1d5db", fontWeight: "400", textTransform: "none", letterSpacing: 0 }}>（选填）</span></label>
              <input
                type="text"
                value={apiBaseUrl}
                onChange={(e) => setApiBaseUrl(e.target.value)}
                placeholder="https://api.openai.com"
                style={inputStyle}
              />
            </div>
            <div style={{ flex: 2 }}>
              <label style={labelStyle}>模型 <span style={{ color: "#d1d5db", fontWeight: "400", textTransform: "none", letterSpacing: 0 }}>（选填）</span></label>
              <input
                type="text"
                value={apiModel}
                onChange={(e) => setApiModel(e.target.value)}
                placeholder="gpt-4o-mini"
                style={inputStyle}
              />
            </div>
          </div>

          <button
            onClick={handleSave}
            style={{
              width: "100%",
              padding: "9px",
              background: saved ? "#16a34a" : "linear-gradient(135deg, #ff5500, #ff8c00)",
              color: "white",
              border: "none",
              borderRadius: "8px",
              fontSize: "13px",
              fontWeight: "600",
              cursor: "pointer",
              transition: "all 0.2s",
              fontFamily: "inherit",
            }}>
            {saved ? "✓ 已保存" : "保存设置"}
          </button>
        </div>
      )}

      {/* ── Tabs ── */}
      <div style={{ display: "flex", background: "white", borderBottom: "1px solid #e5e7eb" }}>
        {([
          { key: "translate" as Tab, label: "翻译 & 摘要" },
          { key: "history" as Tab, label: history.length > 0 ? `历史记录 (${history.length})` : "历史记录" },
        ]).map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            style={{
              flex: 1,
              padding: "10px 8px",
              background: "none",
              border: "none",
              borderBottom: activeTab === key ? "2px solid #ff6600" : "2px solid transparent",
              color: activeTab === key ? "#ff6600" : "#9ca3af",
              fontWeight: activeTab === key ? "600" : "400",
              fontSize: "13px",
              cursor: "pointer",
              transition: "all 0.15s",
              fontFamily: "inherit",
            }}>
            {label}
          </button>
        ))}
      </div>

      {/* ── Translate & Summary Tab ── */}
      {activeTab === "translate" && (
        <div style={{ padding: "14px" }}>

          {/* No API key notice */}
          {!hasApiKey && (
            <div style={{
              background: "#fffbeb",
              border: "1px solid #fde68a",
              borderRadius: "8px",
              padding: "10px 12px",
              marginBottom: "12px",
              fontSize: "12px",
              color: "#92400e",
              display: "flex",
              alignItems: "center",
              gap: "6px",
            }}>
              <span style={{ fontSize: "15px" }}>💡</span>
              点击右上角「设置」配置 API Key 即可开始
            </div>
          )}

          {/* Translate + Toggle row */}
          <div style={{ display: "flex", gap: "8px", marginBottom: "8px" }}>
            <button
              onClick={isTranslating ? handleStop : handleTranslate}
              disabled={!isTranslating && !hasApiKey}
              style={{
                flex: 1,
                padding: "11px 14px",
                background: isTranslating
                  ? "linear-gradient(135deg, #dc2626, #ef4444)"
                  : hasApiKey
                    ? "linear-gradient(135deg, #1d4ed8, #3b82f6)"
                    : "#e5e7eb",
                color: "white",
                border: "none",
                borderRadius: "10px",
                fontSize: "13px",
                fontWeight: "600",
                cursor: (!isTranslating && !hasApiKey) ? "not-allowed" : "pointer",
                transition: "all 0.2s",
                fontFamily: "inherit",
                boxShadow: hasApiKey ? (isTranslating ? "0 3px 10px rgba(220,38,38,0.35)" : "0 3px 10px rgba(29,78,216,0.3)") : "none",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "6px",
              }}>
              {isTranslating ? "⏹ 停止翻译" : "🌐 翻译当前页面"}
            </button>

            <button
              onClick={handleToggleVisibility}
              title={showTranslations ? "隐藏翻译内容" : "显示翻译内容"}
              style={{
                padding: "11px 14px",
                background: showTranslations ? "white" : "#f9fafb",
                color: showTranslations ? "#374151" : "#9ca3af",
                border: `1px solid ${showTranslations ? "#d1d5db" : "#e5e7eb"}`,
                borderRadius: "10px",
                fontSize: "16px",
                cursor: "pointer",
                transition: "all 0.15s",
                lineHeight: "1",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}>
              {showTranslations ? "👁️" : "🙈"}
            </button>
          </div>

          {/* AI Summary button */}
          <button
            onClick={handleSummarize}
            disabled={isSummarizing || !hasSummaryKey}
            style={{
              width: "100%",
              padding: "11px",
              background: isSummarizing
                ? "#7c3aed"
                : hasSummaryKey
                  ? "linear-gradient(135deg, #6d28d9, #a855f7)"
                  : "#e5e7eb",
              color: "white",
              border: "none",
              borderRadius: "10px",
              fontSize: "13px",
              fontWeight: "600",
              cursor: (isSummarizing || !hasSummaryKey) ? "not-allowed" : "pointer",
              transition: "all 0.2s",
              marginBottom: "12px",
              fontFamily: "inherit",
              boxShadow: hasSummaryKey ? "0 3px 10px rgba(109,40,217,0.3)" : "none",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "6px",
            }}>
            {isSummarizing ? "⏳ AI 正在分析..." : "✨ AI 摘要当前页面"}
          </button>

          {/* Translation progress / status */}
          {transStatus !== "idle" && (
            <div style={{
              background: "white",
              border: `1px solid ${transStatus === "done" ? "#bbf7d0" : transStatus === "error" ? "#fecaca" : transStatus === "stopped" ? "#e5e7eb" : "#fed7aa"}`,
              borderRadius: "10px",
              padding: "12px",
              marginBottom: summaryStatus !== "idle" ? "8px" : 0,
            }}>
              {transStatus === "translating" && (
                <>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                    <span style={{ fontSize: "12px", fontWeight: "600", color: "#92400e" }}>⏳ 正在翻译...</span>
                    {progress.total > 0 && (
                      <span style={{ fontSize: "11px", color: "#9ca3af", fontWeight: "500" }}>
                        {progress.done} / {progress.total}
                      </span>
                    )}
                  </div>
                  {progress.total > 0 && (
                    <>
                      <div style={{ height: "5px", background: "#f3f4f6", borderRadius: "99px", overflow: "hidden" }}>
                        <div style={{
                          height: "100%",
                          width: `${Math.round((progress.done / progress.total) * 100)}%`,
                          background: "linear-gradient(90deg, #ff5500, #ff8c00)",
                          borderRadius: "99px",
                          transition: "width 0.35s ease",
                        }} />
                      </div>
                      <div style={{ textAlign: "right", fontSize: "10px", color: "#d1d5db", marginTop: "3px" }}>
                        {Math.round((progress.done / progress.total) * 100)}%
                      </div>
                    </>
                  )}
                </>
              )}
              {transStatus === "done" && (
                <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", color: "#15803d", fontWeight: "500" }}>
                  <span style={{ fontSize: "16px" }}>✅</span>
                  翻译完成，共 {progress.total} 条
                </div>
              )}
              {transStatus === "stopped" && (
                <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", color: "#6b7280", fontWeight: "500" }}>
                  <span style={{ fontSize: "16px" }}>⏹</span>
                  已停止 · 完成 {progress.done} / {progress.total} 条
                </div>
              )}
              {transStatus === "error" && (
                <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", color: "#b91c1c", fontWeight: "500" }}>
                  <span style={{ fontSize: "16px" }}>❌</span>
                  {transError || "翻译失败，请检查 API Key"}
                </div>
              )}
            </div>
          )}

          {/* Summary result */}
          {summaryStatus !== "idle" && (
            <div style={{
              background: "white",
              border: `1px solid ${summaryStatus === "error" ? "#fecaca" : "#e9d5ff"}`,
              borderRadius: "10px",
              padding: "12px",
            }}>
              {summaryStatus === "summarizing" && (
                <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", color: "#7c3aed", fontWeight: "500" }}>
                  <span style={{ fontSize: "16px" }}>✨</span>
                  AI 正在分析文章内容...
                </div>
              )}
              {summaryStatus === "done" && (
                <>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "8px" }}>
                    <span style={{ fontSize: "14px" }}>✨</span>
                    <span style={{ fontSize: "11px", fontWeight: "700", color: "#7c3aed", textTransform: "uppercase", letterSpacing: "0.05em" }}>AI 摘要</span>
                  </div>
                  <div style={{ whiteSpace: "pre-line", fontSize: "13px", color: "#374151", lineHeight: "1.75" }}>{summary}</div>
                </>
              )}
              {summaryStatus === "error" && (
                <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", color: "#b91c1c", fontWeight: "500" }}>
                  <span style={{ fontSize: "16px" }}>❌</span>
                  {summaryError}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── History Tab ── */}
      {activeTab === "history" && (
        <div style={{ padding: "12px 14px 16px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
            <span style={{ fontSize: "11px", color: "#9ca3af", fontWeight: "600", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              {history.length} 条摘要记录
            </span>
            {history.length > 0 && (
              <button
                onClick={handleClearHistory}
                style={{
                  padding: "4px 10px",
                  background: "none",
                  border: "1px solid #e5e7eb",
                  borderRadius: "6px",
                  fontSize: "11px",
                  color: "#9ca3af",
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}>
                清空
              </button>
            )}
          </div>

          {history.length === 0 ? (
            <div style={{ textAlign: "center", padding: "44px 0 36px" }}>
              <div style={{ fontSize: "44px", marginBottom: "12px" }}>📚</div>
              <div style={{ color: "#9ca3af", fontSize: "13px", lineHeight: "1.7" }}>
                暂无历史记录
              </div>
              <div style={{ color: "#d1d5db", fontSize: "12px", marginTop: "4px" }}>
                使用「AI 摘要」后会保存在这里
              </div>
            </div>
          ) : (
            <div style={{ maxHeight: "460px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "8px" }}>
              {history.map((item, i) => (
                <div
                  key={i}
                  style={{
                    background: "white",
                    borderRadius: "10px",
                    border: "1px solid #e5e7eb",
                    padding: "12px",
                  }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "7px" }}>
                    <a
                      href={item.url}
                      target="_blank"
                      style={{
                        color: "#1d4ed8",
                        fontSize: "12px",
                        fontWeight: "600",
                        textDecoration: "none",
                        flex: 1,
                        marginRight: "8px",
                        lineHeight: "1.5",
                        display: "-webkit-box",
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: "vertical",
                        overflow: "hidden",
                      }}>
                      {item.title}
                    </a>
                    <span style={{ fontSize: "10px", color: "#d1d5db", whiteSpace: "nowrap", flexShrink: 0, paddingTop: "1px" }}>
                      {formatTime(item.timestamp)}
                    </span>
                  </div>
                  <div
                    style={{
                      fontSize: "12px",
                      color: "#6b7280",
                      lineHeight: "1.75",
                      whiteSpace: "pre-line",
                      maxHeight: expandedIndex === i ? "none" : "78px",
                      overflow: expandedIndex === i ? "visible" : "hidden",
                      cursor: "pointer",
                      maskImage: expandedIndex === i ? "none" : "linear-gradient(to bottom, black 55%, transparent 100%)",
                    }}
                    onClick={() => setExpandedIndex(expandedIndex === i ? null : i)}>
                    {item.summary}
                  </div>
                  <button
                    onClick={() => setExpandedIndex(expandedIndex === i ? null : i)}
                    style={{
                      background: "none",
                      border: "none",
                      color: "#c4b5fd",
                      fontSize: "11px",
                      fontWeight: "500",
                      cursor: "pointer",
                      padding: "5px 0 0",
                      fontFamily: "inherit",
                      display: "flex",
                      alignItems: "center",
                      gap: "2px",
                    }}>
                    {expandedIndex === i ? "▲ 收起" : "▼ 展开"}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default IndexPopup
