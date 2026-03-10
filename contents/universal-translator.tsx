import type { PlasmoCSConfig } from "plasmo"
import { useEffect } from "react"
import { Readability } from "@mozilla/readability"

export const config: PlasmoCSConfig = {
  matches: ["<all_urls>"],
  exclude_matches: ["https://news.ycombinator.com/*"],
  all_frames: false
}

// 控制翻译内容的可见性
const VISIBILITY_STYLE_ID = "hn-dual-visibility"
const HIDE_CSS = `.hn-dual-translation { display: none !important; }`

function applyVisibility(show: boolean) {
  let el = document.getElementById(VISIBILITY_STYLE_ID) as HTMLStyleElement | null
  if (!show) {
    if (!el) {
      el = document.createElement("style")
      el.id = VISIBILITY_STYLE_ID
      document.head.appendChild(el)
    }
    el.textContent = HIDE_CSS
  } else {
    el?.remove()
  }
}

// 判断当前页面是否从 HN 跳转过来
async function isFromHackerNews(): Promise<boolean> {
  if (document.referrer.includes("news.ycombinator.com")) {
    console.log("HN Dual: referrer is HN")
    return true
  }
  try {
    const response = await chrome.runtime.sendMessage({ type: "CHECK_HN_REFERRER" })
    console.log("HN Dual: background check result:", response?.isFromHN)
    return response?.isFromHN ?? false
  } catch (error) {
    console.error("HN Dual: CHECK_HN_REFERRER error:", error)
    return false
  }
}

// 检测文章内容
function detectArticle() {
  try {
    const documentClone = document.cloneNode(true) as Document
    const reader = new Readability(documentClone)
    const article = reader.parse()

    if (!article || !article.textContent || article.textContent.length < 200) {
      return null
    }

    const paragraphs = Array.from(
      document.querySelectorAll(
        'article p, .post-content p, .entry-content p, .article-content p, main p, [role="main"] p'
      )
    ).filter((p) => {
      const text = p.textContent?.trim() || ""
      return text.length > 50
    }) as HTMLElement[]

    return { title: article.title, paragraphs }
  } catch (error) {
    console.error("Article detection error:", error)
    return null
  }
}

// 翻译文章，样式继承原页面
async function translateArticle(article: { title: string; paragraphs: HTMLElement[] }) {
  const titleElement = document.querySelector("h1")
  if (titleElement && !titleElement.querySelector(".hn-dual-translation")) {
    try {
      const response = await chrome.runtime.sendMessage({
        type: "TRANSLATE",
        text: article.title,
        targetLang: "zh"
      })
      if (response.translation) {
        const div = document.createElement("div")
        div.className = "hn-dual-translation"
        // 继承 h1 字体，稍微缩小、变灰
        div.style.cssText = `
          font-size: 0.75em;
          font-weight: normal;
          color: inherit;
          opacity: 0.65;
          margin-top: 6px;
        `
        div.textContent = response.translation
        titleElement.appendChild(div)
      }
    } catch (error) {
      console.error("Title translation error:", error)
    }
  }

  for (const paragraph of article.paragraphs) {
    if (paragraph.querySelector(".hn-dual-translation")) continue

    const text = paragraph.textContent?.trim() || ""
    if (text.length < 20) continue

    try {
      const response = await chrome.runtime.sendMessage({
        type: "TRANSLATE",
        text,
        targetLang: "zh"
      })
      if (response.translation) {
        const div = document.createElement("div")
        div.className = "hn-dual-translation"
        // 完全继承原段落的字体/大小/颜色，只加透明度区分
        div.style.cssText = `
          display: block;
          margin-top: 0.4em;
          opacity: 0.7;
        `
        div.textContent = response.translation
        paragraph.after(div)
      }
    } catch (error) {
      console.error("Paragraph translation error:", error)
    }

    await new Promise((resolve) => setTimeout(resolve, 500))
  }
}

// 主组件：只在从 HN 打开时自动翻译，不显示任何 UI
const AutoTranslator = () => {
  useEffect(() => {
    // 初始化可见性
    chrome.storage.local.get(["showTranslations"], (result) => {
      applyVisibility(result.showTranslations !== false)
    })

    // 监听显示/隐藏切换
    chrome.runtime.onMessage.addListener((message) => {
      if (message.type === "TOGGLE_TRANSLATIONS") {
        applyVisibility(message.show)
      }
    })
    ;(async () => {
      const fromHN = await isFromHackerNews()
      if (!fromHN) return

      const article = detectArticle()
      if (!article) return

      await translateArticle(article)
    })()
  }, [])

  // 不渲染任何 UI
  return null
}

export default AutoTranslator
