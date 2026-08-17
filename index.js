import { extension_settings } from "../../../extensions.js";
import { chat, eventSource, event_types, getRequestHeaders, saveChatConditional, saveSettingsDebounced } from "../../../../script.js";

const extensionName = "st-chatu8";
const clientId = "scene-draw-" + (crypto.randomUUID?.() || Math.random().toString(36).slice(2));
const logPrefix = "[本轮生图]";
let generationClickHandlerBound = false;

// Supplied Krea workflow, already in ComfyUI API format.
const defaultWorkflow = {
  "3": { "inputs": { "text": "<lora:LiRuinan_v2:1.00>, <lora:SNOFS_krea_v1_2:1.00>, <lora:penis_size_krea2_v2_loraholic:-4.00:-4.00>, <lora:breast_size_v2_krea2_loraholic:-1.00>", "loras": { "__value__": [{ "name": "LiRuinan_v2", "strength": "1.00", "active": true, "expanded": false, "clipStrength": "1.00", "selected": false, "locked": false }, { "name": "breast_size_v2_krea2_loraholic", "strength": "-1.00", "active": true, "expanded": false, "clipStrength": "-1.00", "selected": false, "locked": false }, { "name": "penis_size_krea2_v2_loraholic", "strength": "-3.00", "active": true, "expanded": false, "clipStrength": "-3.00", "selected": false, "locked": false }, { "name": "SNOFS_krea_v1_2", "strength": 1, "active": true, "expanded": false, "clipStrength": 1, "selected": false, "locked": false }] }, "model": ["10", 0], "clip": ["6", 0] }, "class_type": "Lora Loader (LoraManager)" },
  "5": { "inputs": { "text": "{{prompt}}", "clip": ["3", 1] }, "class_type": "CLIPTextEncode" },
  "6": { "inputs": { "clip_name": "{{clipName}}", "type": "krea2", "device": "default" }, "class_type": "CLIPLoader" },
  "7": { "inputs": { "vae_name": "{{vaeName}}" }, "class_type": "VAELoader" },
  "8": { "inputs": { "text": "{{negativePrompt}}", "clip": ["3", 1] }, "class_type": "CLIPTextEncode" },
  "9": { "inputs": { "seed": "{{seed}}" }, "class_type": "Seed (rgthree)" },
  "10": { "inputs": { "unet_name": "{{modelName}}", "weight_dtype": "default" }, "class_type": "UNETLoader" },
  "11": { "inputs": { "conditioning": ["5", 0] }, "class_type": "ConditioningZeroOut" },
  "12": { "inputs": { "samples": ["14", 0], "vae": ["7", 0] }, "class_type": "VAEDecode" },
  "13": { "inputs": { "width": "{{width}}", "height": "{{height}}", "batch_size": "{{batchSize}}" }, "class_type": "EmptyLatentImage" },
  "14": { "inputs": { "seed": ["9", 0], "steps": "{{steps}}", "cfg": "{{cfg}}", "sampler_name": "{{samplerName}}", "scheduler": "{{scheduler}}", "denoise": "{{denoise}}", "model": ["3", 0], "positive": ["5", 0], "negative": ["11", 0], "latent_image": ["13", 0] }, "class_type": "KSampler" },
  "15": { "inputs": { "filename_prefix": "Krea2", "images": ["12", 0] }, "class_type": "SaveImage" }
};

const defaults = {
  enabled: true, comfyUrl: "http://127.0.0.1:8188", useComfyProxy: true,
  workflow: JSON.stringify(defaultWorkflow, null, 2), positiveNodeId: "5", positiveInputName: "text",
  llmBaseUrl: "", llmApiKey: "", llmModel: "", llmUseProxy: true, llmTemperature: 0.3,
  modelName: "krea2_turbo_fp8_scaled.safetensors", clipName: "qwen3VLInstruct4bHeretic_int8Convrot.safetensors", vaeName: "qwen_image_vae.safetensors",
  negativePrompt: "马赛克, mosaic, censored, 模糊，低分辨率，低质量图像，扭曲的肢体，诡异的外观，丑陋，噪点，网格感，JPEG压缩条纹，异常的肢体，水印，乱码，意义不明的字符",
  width: 1024, height: 1024, batchSize: 1, seed: 31982231011750, steps: 8, cfg: 1, samplerName: "er_sde", scheduler: "simple", denoise: 1,
  summaryPrompt: "你是绘图提示词整理助手。只根据下面这一条 AI 回复提炼画面场景，保留人物、动作、服饰、环境、镜头和光线；输出适合 ComfyUI 的简洁正向提示词。不要解释、不要加引号、不要虚构未出现的细节。\n\nAI 本轮回复：\n{{message}}"
};

function settings() {
  extension_settings[extensionName] ||= {};
  Object.entries(defaults).forEach(([key, value]) => extension_settings[extensionName][key] ??= value);
  return extension_settings[extensionName];
}
function save() { saveSettingsDebounced(); }
function headers() { return getRequestHeaders(); }
function notify(kind, message) {
  if (window.toastr?.[kind]) window.toastr[kind](message, "本轮生图");
  else console[kind === "error" ? "error" : "log"]("[本轮生图] " + message);
}
function debug(event, detail = {}) {
  console.info(logPrefix + " " + event, detail);
}
function cleanText(value) {
  return String(value || "").replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/<thinking>[\s\S]*?<\/thinking>/gi, "").replace(/<\/??image[^>]*>/gi, "").trim();
}
function workflowVariables(prompt) {
  const conf = settings();
  return {
    prompt,
    modelName: conf.modelName,
    clipName: conf.clipName,
    vaeName: conf.vaeName,
    negativePrompt: conf.negativePrompt,
    width: conf.width,
    height: conf.height,
    batchSize: conf.batchSize,
    seed: conf.seed,
    steps: conf.steps,
    cfg: conf.cfg,
    samplerName: conf.samplerName,
    scheduler: conf.scheduler,
    denoise: conf.denoise
  };
}
function replacePlaceholders(value, values) {
  if (Array.isArray(value)) return value.map((item) => replacePlaceholders(item, values));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replacePlaceholders(item, values)]));
  if (typeof value !== "string") return value;
  const exact = value.match(/^\{\{([a-zA-Z0-9_]+)\}\}$/);
  if (exact && exact[1] in values) return values[exact[1]];
  return value.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (match, key) => key in values ? String(values[key]) : match);
}

async function summarizeTurn(text) {
  const conf = settings();
  if (!conf.llmBaseUrl || !conf.llmApiKey || !conf.llmModel) throw new Error("请先填写 LLM Base URL、API Key 和模型名称。");
  debug("开始请求 LLM 场景总结", { baseUrl: conf.llmBaseUrl, model: conf.llmModel, viaProxy: conf.llmUseProxy, reasoningEnabled: false, messageLength: text.length });
  const prompt = conf.summaryPrompt.includes("{{message}}") ? conf.summaryPrompt.replaceAll("{{message}}", text) : conf.summaryPrompt + "\n\nAI 本轮回复：\n" + text;
  const completion = { model: conf.llmModel, messages: [{ role: "user", content: prompt }], temperature: Number(conf.llmTemperature), stream: false, enable_thinking: false };
  let url, requestHeaders, body;
  if (conf.llmUseProxy) {
    url = "/api/backends/chat-completions/generate";
    requestHeaders = headers();
    body = { chat_completion_source: "custom", custom_url: conf.llmBaseUrl.replace(/\/$/, ""), custom_include_headers: 'Authorization: "Bearer ' + conf.llmApiKey + '"', ...completion };
  } else {
    url = conf.llmBaseUrl.replace(/\/$/, "") + "/chat/completions";
    requestHeaders = { "Content-Type": "application/json", "Authorization": "Bearer " + conf.llmApiKey };
    body = completion;
  }
  const response = await fetch(url, { method: "POST", headers: requestHeaders, body: JSON.stringify(body) });
  debug("LLM 场景总结响应", { status: response.status, ok: response.ok });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) throw new Error(data.error?.message || data.message || "LLM 请求失败（" + response.status + "）");
  const result = cleanText(data.choices?.[0]?.message?.content);
  if (!result) throw new Error("LLM 没有返回可用的场景提示词。");
  debug("LLM 场景总结完成", { promptLength: result.length });
  return result;
}

async function fetchLlmModels() {
  const conf = settings();
  if (!conf.llmBaseUrl || !conf.llmApiKey) throw new Error("请先填写 LLM Base URL 和 API Key。");
  let response;
  if (conf.llmUseProxy) {
    response = await fetch("/api/backends/chat-completions/status", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        chat_completion_source: "custom",
        custom_url: conf.llmBaseUrl.replace(/\/$/, ""),
        custom_include_headers: 'Authorization: "Bearer ' + conf.llmApiKey + '"'
      })
    });
  } else {
    response = await fetch(conf.llmBaseUrl.replace(/\/$/, "") + "/models", {
      headers: { "Authorization": "Bearer " + conf.llmApiKey }
    });
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) throw new Error(data.error?.message || data.message || "LLM 连接失败（" + response.status + "）");
  const models = (data.data || data.models || []).map((model) => typeof model === "string" ? model : model.id).filter(Boolean).sort();
  if (!models.length) throw new Error("连接成功，但接口没有返回模型列表。");
  return models;
}

async function testComfyConnection() {
  const conf = settings();
  if (!conf.comfyUrl) throw new Error("请先填写 ComfyUI 地址。");
  let response;
  if (conf.useComfyProxy) {
    response = await fetch("/api/sd/comfy/models", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ url: conf.comfyUrl.replace(/\/$/, "") })
    });
  } else {
    response = await fetch(conf.comfyUrl.replace(/\/$/, "") + "/object_info");
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) throw new Error(data.error?.message || data.message || "ComfyUI 连接失败（" + response.status + "）");
  return data;
}

function workflowWithPrompt(prompt) {
  const conf = settings();
  let workflow;
  try { workflow = JSON.parse(conf.workflow); } catch (error) { throw new Error("工作流 JSON 无效：" + error.message); }
  const node = workflow[conf.positiveNodeId];
  if (!node?.inputs || !(conf.positiveInputName in node.inputs)) throw new Error("找不到正向提示词位置：节点 " + conf.positiveNodeId + " 的 " + conf.positiveInputName + "。");
  node.inputs[conf.positiveInputName] = prompt;
  return replacePlaceholders(workflow, workflowVariables(prompt));
}
function outputImage(record) {
  for (const output of Object.values(record.outputs || {})) {
    const file = output.images?.find((item) => item.type === "output") || output.images?.[0];
    if (file) return file;
  }
  return null;
}
function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
async function persistImage(imageDataUrl) {
  if (!imageDataUrl.startsWith("data:")) return imageDataUrl;
  const matched = imageDataUrl.match(/^data:image\/([a-zA-Z0-9.+-]+);base64,([\s\S]+)$/);
  if (!matched) throw new Error("生成图片的格式无效，无法保存到酒馆。");
  const [, format, image] = matched;
  debug("正在上传生成图片到酒馆", { format, base64Length: image.length });
  const response = await fetch("/api/images/upload", {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ image, format })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.path) throw new Error(data.error?.message || data.message || "酒馆未能保存生成图片（" + response.status + "）。");
  debug("生成图片已保存到酒馆", { path: data.path });
  return data.path;
}

async function generateDirect(workflow, onProgress) {
  const base = settings().comfyUrl.replace(/\/$/, "");
  debug("直连提交 ComfyUI 工作流", { url: base, nodeCount: Object.keys(workflow).length });
  const response = await fetch(base + "/prompt", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ client_id: clientId, prompt: workflow }) });
  const queued = await response.json().catch(() => ({}));
  if (!response.ok || !queued.prompt_id) throw new Error(queued.error?.message || "ComfyUI 提交失败（" + response.status + "）");
  debug("ComfyUI 已接收工作流", { promptId: queued.prompt_id });
  onProgress?.("generating", "ComfyUI 已接收任务，正在生成图片");
  const deadline = Date.now() + 600000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const history = await fetch(base + "/history/" + encodeURIComponent(queued.prompt_id)).then((r) => r.json()).catch(() => ({}));
    const record = history[queued.prompt_id];
    if (!record) continue;
    if (record.status?.status_str === "error") throw new Error(record.status?.exception_message || "ComfyUI 工作流执行失败。");
    const file = outputImage(record);
    if (!file) continue;
    debug("ComfyUI 生成完成，正在下载图片", { filename: file.filename, subfolder: file.subfolder || "" });
    const params = new URLSearchParams({ filename: file.filename, subfolder: file.subfolder || "", type: file.type || "output" });
    const imageResponse = await fetch(base + "/view?" + params);
    if (!imageResponse.ok) throw new Error("ComfyUI 已完成，但无法下载图片。");
    return blobToDataUrl(await imageResponse.blob());
  }
  throw new Error("等待 ComfyUI 图片超时（10 分钟）。");
}
async function generateProxy(workflow, onProgress) {
  onProgress?.("generating", "任务已交给酒馆代理，正在等待 ComfyUI 完成");
  debug("通过酒馆代理提交 ComfyUI 工作流", { url: settings().comfyUrl, nodeCount: Object.keys(workflow).length });
  const response = await fetch("/api/sd/comfy/generate", { method: "POST", headers: headers(), body: JSON.stringify({ url: settings().comfyUrl, prompt: JSON.stringify({ client_id: clientId, prompt: workflow }) }) });
  debug("酒馆代理 ComfyUI 响应", { status: response.status, ok: response.ok });
  const raw = await response.text();
  if (!response.ok) throw new Error(raw || "ComfyUI 代理请求失败（" + response.status + "）");
  let data;
  try { data = JSON.parse(raw); } catch { data = { data: raw, format: "png" }; }
  if (!data.data) throw new Error(data.error?.message || "酒馆代理没有返回图片数据。");
  return "data:image/" + (data.format || "png") + ";base64," + data.data;
}
async function generateImage(prompt, onProgress) {
  if (!settings().comfyUrl) throw new Error("请先填写 ComfyUI 地址。");
  debug("开始 ComfyUI 生图", { viaProxy: settings().useComfyProxy, promptLength: prompt.length });
  onProgress?.("submitting", "正在整理工作流并提交给 ComfyUI");
  const workflow = workflowWithPrompt(prompt);
  return settings().useComfyProxy ? generateProxy(workflow, onProgress) : generateDirect(workflow, onProgress);
}

const workflowSteps = [
  ["summarizing", "总结", "总结场景"],
  ["submitting", "提交", "提交工作流"],
  ["generating", "生成", "ComfyUI 生成"],
  ["completed", "完成", "图片生成完成"]
];
let activeMessageId = null;
let sidebarTrackingBound = false;

function isAiMessage(mesId) {
  const message = chat[Number(mesId)];
  return Boolean(message && !message.is_user && !message.is_system);
}
function workflowWidget(mesId, state) {
  const currentIndex = workflowSteps.findIndex(([key]) => key === state.step);
  const workflow = document.createElement("div");
  workflow.className = "scene-draw-workflow scene-draw-workflow--sidebar scene-draw-workflow--" + state.step;
  const track = document.createElement("div");
  track.className = "scene-draw-workflow-track";
  workflowSteps.forEach(([key, text, title], index) => {
    const canShowSummary = key === "summarizing" && Boolean(chat[Number(mesId)]?.extra?.sceneDrawPrompt);
    const item = document.createElement(canShowSummary ? "button" : "div");
    item.className = "scene-draw-workflow-step";
    if (canShowSummary) {
      item.type = "button";
      item.classList.add("scene-draw-workflow-summary");
      item.dataset.sceneDrawMesid = String(mesId);
      item.title = "查看 LLM 总结的场景提示词";
      item.setAttribute("aria-label", "查看总结场景");
    } else item.title = title;
    if (state.step === "failed" && index === currentIndex) item.classList.add("failed");
    else if (index < currentIndex || state.step === "completed") item.classList.add("done");
    else if (index === currentIndex) item.classList.add("active");
    const marker = document.createElement("span");
    marker.className = "scene-draw-workflow-marker";
    marker.textContent = item.classList.contains("done") ? "✓" : String(index + 1);
    const label = document.createElement("span");
    label.textContent = text;
    item.append(marker, label);
    track.append(item);
  });
  const detail = document.createElement("div");
  detail.className = "scene-draw-workflow-detail";
  detail.title = state.detail || "";
  detail.textContent = state.step === "completed" ? "已完成" : state.step === "summarizing" ? "正在总结" : state.step === "submitting" ? "正在提交" : state.step === "generating" ? "正在生成" : state.step === "failed" ? "失败" : state.detail || "";
  workflow.append(track, detail);
  return workflow;
}
function ensureSidebar() {
  let sidebar = document.querySelector("#scene-draw-sidebar");
  if (sidebar) return sidebar;
  sidebar = document.createElement("aside");
  sidebar.id = "scene-draw-sidebar";
  sidebar.className = "scene-draw-sidebar";
  sidebar.hidden = true;
  sidebar.setAttribute("aria-label", "本轮生图工具栏");
  document.body.append(sidebar);
  return sidebar;
}
function renderSidebar() {
  const sidebar = ensureSidebar();
  const message = activeMessageId === null ? null : chat[Number(activeMessageId)];
  if (!message || message.is_user || message.is_system) {
    sidebar.hidden = true;
    sidebar.replaceChildren();
    return;
  }
  sidebar.hidden = false;
  const generate = document.createElement("button");
  generate.type = "button";
  generate.className = "scene-draw-sidebar-generate";
  generate.dataset.sceneDrawMesid = String(activeMessageId);
  generate.disabled = Boolean(message.extra?.sceneDrawBusy);
  generate.title = message.extra?.sceneDrawBusy ? "正在生成图片" : "总结当前 AI 回复并生成图片";
  generate.setAttribute("aria-label", "生成图片");
  generate.innerHTML = '<i class="fa-solid ' + (message.extra?.sceneDrawBusy ? "fa-spinner fa-spin" : "fa-image") + '"></i>';
  const label = document.createElement("span");
  label.className = "scene-draw-sidebar-label";
  label.textContent = "生图";
  sidebar.replaceChildren(generate, label);
  if (message.extra?.sceneDrawState) sidebar.append(workflowWidget(activeMessageId, message.extra.sceneDrawState));
}
function updateActiveMessage() {
  const targetY = window.innerHeight * .5;
  const visible = [...document.querySelectorAll(".mes[mesid]")].map((mes) => ({ mes, rect: mes.getBoundingClientRect() }))
    .filter(({ rect }) => rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < window.innerHeight);
  const centered = visible.filter(({ rect }) => rect.top <= targetY && rect.bottom >= targetY);
  const candidate = (centered.length ? centered : visible).sort((a, b) => Math.abs((a.rect.top + a.rect.bottom) / 2 - targetY) - Math.abs((b.rect.top + b.rect.bottom) / 2 - targetY))[0];
  const mesId = candidate?.mes.getAttribute("mesid");
  const nextId = mesId !== null && mesId !== undefined && isAiMessage(mesId) ? mesId : null;
  if (activeMessageId === nextId) return;
  activeMessageId = nextId;
  renderSidebar();
}
function bindSidebarTracking() {
  if (sidebarTrackingBound) return;
  sidebarTrackingBound = true;
  document.addEventListener("scroll", updateActiveMessage, true);
  window.addEventListener("resize", updateActiveMessage);
}
function renderWorkflowState() {
  renderSidebar();
}
function setWorkflowState(mesId, message, step, detail) {
  message.extra ||= {};
  message.extra.sceneDrawState = { step, detail };
  debug("状态更新", { mesId: Number(mesId), step, detail });
  renderWorkflowState();
}
function renderImage(mesId, imageUrl, prompt, messageElement) {
  const mes = messageElement || document.querySelector('.mes[mesid="' + CSS.escape(String(mesId)) + '"]');
  if (!mes) return;
  mes.querySelector(".scene-draw-result")?.remove();
  const result = document.createElement("div");
  result.className = "scene-draw-result";
  const download = document.createElement("a");
  download.className = "scene-draw-result-download";
  download.href = imageUrl;
  download.download = "scene-draw-" + mesId + ".png";
  download.title = "下载图片";
  download.setAttribute("aria-label", "下载图片");
  download.innerHTML = '<i class="fa-solid fa-download"></i>';
  const image = document.createElement("img");
  image.className = "scene-draw-result-image";
  image.src = imageUrl; image.alt = prompt; image.title = "点击全屏查看图片";
  result.append(download, image);
  const text = mes.querySelector(".mes_text");
  if (text) text.after(result); else mes.append(result);
}
async function runForMessage(mesId, button) {
  const initialMessage = chat[Number(mesId)];
  if (!settings().enabled || button.disabled || initialMessage?.extra?.sceneDrawBusy) return;
  const icon = button.querySelector("i");
  button.disabled = true;
  if (icon) icon.className = "fa-solid fa-spinner fa-spin";
  try {
    const message = chat[Number(mesId)];
    if (!message || message.is_user || message.is_system) throw new Error("请在一条 AI 回复上点击生成图片。");
    message.extra ||= {};
    message.extra.sceneDrawBusy = true;
    renderSidebar();
    const text = cleanText(message.mes);
    if (!text) throw new Error("这条 AI 回复没有可用于总结的文本。");
    debug("点击生成图片", { mesId: Number(mesId), messageLength: text.length });
    button.title = "正在总结场景";
    setWorkflowState(mesId, message, "summarizing", "正在使用 LLM 总结本轮 AI 回复");
    const prompt = await summarizeTurn(text);
    message.extra.sceneDrawPrompt = prompt;
    button.title = "正在生成图片";
    const image = await generateImage(prompt, (step, detail) => setWorkflowState(mesId, message, step, detail));
    setWorkflowState(mesId, message, "generating", "图片已生成，正在保存到酒馆");
    const savedImage = await persistImage(image);
    message.extra.sceneDrawImage = savedImage;
    renderImage(mesId, savedImage, prompt);
    setWorkflowState(mesId, message, "completed", "图片生成完成，可在下方查看");
    await saveChatConditional();
    notify("success", "图片已生成。");
  } catch (error) {
    console.error(logPrefix + " 生成图片失败", error);
    const message = chat[Number(mesId)];
    if (message) {
      setWorkflowState(mesId, message, "failed", error.message || String(error));
      await saveChatConditional();
    }
    notify("error", error.message || String(error));
  } finally {
    button.title = "总结此条 AI 回复并生成图片";
    if (icon) icon.className = "fa-solid fa-image";
    button.disabled = false;
    const message = chat[Number(mesId)];
    if (message?.extra) delete message.extra.sceneDrawBusy;
    renderSidebar();
  }
}
function decorateMessage(mes) {
  const mesId = mes.getAttribute("mesid");
  if (mesId === null) return;
  const message = chat[Number(mesId)];
  if (!message || message.is_user || message.is_system) return;
  mes.querySelectorAll(".scene-draw-button, .scene-draw-workflow").forEach((element) => element.remove());
  if (message.extra?.sceneDrawImage && !mes.querySelector(".scene-draw-result")) renderImage(mesId, message.extra.sceneDrawImage, message.extra.sceneDrawPrompt || "", mes);
}
function decorateMessages() { document.querySelectorAll(".mes[mesid]").forEach(decorateMessage); }
function showSummaryModal(mesId) {
  const summary = chat[Number(mesId)]?.extra?.sceneDrawPrompt;
  if (!summary) return;
  document.querySelector(".scene-draw-summary-modal")?.remove();
  const modal = document.createElement("div");
  modal.className = "scene-draw-summary-modal";
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("aria-label", "场景总结内容");
  const panel = document.createElement("section");
  panel.className = "scene-draw-summary-modal-panel";
  const title = document.createElement("h3");
  title.textContent = "LLM 场景总结";
  const content = document.createElement("pre");
  content.className = "scene-draw-summary-modal-content";
  content.textContent = summary;
  const close = document.createElement("button");
  close.type = "button";
  close.className = "menu_button scene-draw-summary-modal-close";
  close.textContent = "关闭";
  close.addEventListener("click", () => modal.remove());
  panel.append(title, content, close);
  modal.append(panel);
  modal.addEventListener("click", (event) => {
    if (event.target === modal) modal.remove();
  });
  document.body.append(modal);
  close.focus();
}
function showImageViewer(imageUrl, prompt) {
  document.querySelector(".scene-draw-image-viewer")?.remove();
  const viewer = document.createElement("div");
  viewer.className = "scene-draw-image-viewer";
  viewer.setAttribute("role", "dialog");
  viewer.setAttribute("aria-modal", "true");
  viewer.setAttribute("aria-label", "全屏查看图片");
  const image = document.createElement("img");
  image.src = imageUrl;
  image.alt = prompt || "生成图片";
  image.title = "再次点击关闭";
  viewer.append(image);
  viewer.addEventListener("click", () => viewer.remove());
  document.body.append(viewer);
}
function bindGenerationClickHandler() {
  if (generationClickHandlerBound) return;
  generationClickHandlerBound = true;
  // Some character-card beautifiers clone or replace message nodes. Event
  // delegation keeps copied image buttons functional after that transformation.
  document.addEventListener("click", (event) => {
    const image = event.target instanceof Element ? event.target.closest(".scene-draw-result-image") : null;
    if (image) {
      event.preventDefault();
      event.stopPropagation();
      showImageViewer(image.currentSrc || image.src, image.alt);
      return;
    }
    const summaryButton = event.target instanceof Element ? event.target.closest(".scene-draw-workflow-summary") : null;
    if (summaryButton) {
      event.preventDefault();
      event.stopPropagation();
      showSummaryModal(summaryButton.dataset.sceneDrawMesid);
      return;
    }
    const target = event.target instanceof Element ? event.target.closest(".scene-draw-sidebar-generate, .scene-draw-button") : null;
    const mes = target?.closest(".mes[mesid]");
    const mesId = target?.dataset.sceneDrawMesid || mes?.getAttribute("mesid");
    if (!target || mesId === null || mesId === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    runForMessage(mesId, target);
  }, true);
  debug("已启用委托点击监听", { reason: "兼容消息美化脚本" });
}

function settingField(label, input) {
  const row = document.createElement("label");
  row.className = "scene-draw-field";
  const title = document.createElement("span");
  title.textContent = label;
  row.append(title, input);
  return row;
}
function inputFor(key, type = "text") {
  const input = document.createElement("input");
  input.type = type; input.value = settings()[key];
  input.addEventListener("input", () => { settings()[key] = type === "number" ? Number(input.value) : input.value; save(); });
  return input;
}
function actionField(label, input, button) {
  const group = document.createElement("div");
  group.className = "scene-draw-input-action";
  group.append(input, button);
  return settingField(label, group);
}
function statusLine() {
  const line = document.createElement("div");
  line.className = "scene-draw-connection-status";
  line.textContent = "尚未测试";
  return line;
}
function setStatus(line, success, message) {
  line.classList.toggle("success", success);
  line.classList.toggle("error", !success);
  line.textContent = message;
}
function modelSelect() {
  const select = document.createElement("select");
  const saved = settings().llmModel;
  select.add(new Option(saved || "请先测试连接并获取模型", saved || ""));
  select.addEventListener("change", () => { settings().llmModel = select.value; save(); });
  return select;
}
function addHeading(text) {
  const heading = document.createElement("h4");
  heading.className = "scene-draw-heading";
  heading.textContent = text;
  return heading;
}
function addSettings() {
  if (document.querySelector("#scene-draw-settings")) return;
  const panel = document.createElement("details");
  panel.id = "scene-draw-settings"; panel.className = "inline-drawer";
  panel.innerHTML = '<summary><i class="fa-solid fa-image"></i> 本轮生图设置</summary><p>点击每条 AI 回复上的“生成图片”后，只会将该条回复交给 LLM 总结并生成。</p>';
  const content = document.createElement("div");
  content.className = "scene-draw-settings-content";
  content.append(addHeading("LLM 连接"));
  const llmUrl = inputFor("llmBaseUrl");
  const llmTest = document.createElement("button");
  llmTest.type = "button"; llmTest.className = "menu_button"; llmTest.textContent = "测试并获取模型";
  const llmStatus = statusLine();
  const models = modelSelect();
  llmTest.addEventListener("click", async () => {
    llmTest.disabled = true; setStatus(llmStatus, true, "正在连接 LLM 并获取模型列表…");
    try {
      const list = await fetchLlmModels();
      const selected = settings().llmModel;
      models.replaceChildren(...list.map((name) => new Option(name, name, name === selected, name === selected)));
      settings().llmModel = models.value || list[0];
      save();
      setStatus(llmStatus, true, "LLM 连接成功，已获取 " + list.length + " 个模型。");
      notify("success", "LLM 连接成功，已加载模型列表。");
    } catch (error) {
      setStatus(llmStatus, false, "LLM 连接失败：" + error.message);
      notify("error", "LLM 连接失败：" + error.message);
    } finally { llmTest.disabled = false; }
  });
  content.append(actionField("LLM Base URL（含 /v1）", llmUrl, llmTest), settingField("LLM API Key", inputFor("llmApiKey", "password")), settingField("LLM 模型", models), llmStatus, settingField("Temperature", inputFor("llmTemperature", "number")));
  content.append(addHeading("ComfyUI 连接"));
  const comfyUrl = inputFor("comfyUrl");
  const comfyTest = document.createElement("button");
  comfyTest.type = "button"; comfyTest.className = "menu_button"; comfyTest.textContent = "测试连接";
  const comfyStatus = statusLine();
  comfyTest.addEventListener("click", async () => {
    comfyTest.disabled = true; setStatus(comfyStatus, true, "正在连接 ComfyUI…");
    try {
      await testComfyConnection();
      setStatus(comfyStatus, true, "ComfyUI 连接成功。");
      notify("success", "ComfyUI 连接成功。");
    } catch (error) {
      setStatus(comfyStatus, false, "ComfyUI 连接失败：" + error.message);
      notify("error", "ComfyUI 连接失败：" + error.message);
    } finally { comfyTest.disabled = false; }
  });
  content.append(actionField("ComfyUI 地址", comfyUrl, comfyTest), comfyStatus);
  [["useComfyProxy", "通过酒馆代理连接 ComfyUI"], ["llmUseProxy", "通过酒馆代理调用 LLM"]].forEach(([key, label]) => {
    const input = document.createElement("input");
    input.type = "checkbox"; input.checked = settings()[key];
    input.addEventListener("change", () => { settings()[key] = input.checked; save(); });
    content.append(settingField(label, input));
  });
  content.append(addHeading("工作流常用参数"));
  content.append(
    settingField("UNet / 模型文件（{{modelName}}）", inputFor("modelName")),
    settingField("CLIP 文件（{{clipName}}）", inputFor("clipName")),
    settingField("VAE 文件（{{vaeName}}）", inputFor("vaeName")),
    settingField("负面提示词（{{negativePrompt}}）", inputFor("negativePrompt")),
    settingField("宽度（{{width}}）", inputFor("width", "number")),
    settingField("高度（{{height}}）", inputFor("height", "number")),
    settingField("批次数（{{batchSize}}）", inputFor("batchSize", "number")),
    settingField("种子（{{seed}}）", inputFor("seed", "number")),
    settingField("步数（{{steps}}）", inputFor("steps", "number")),
    settingField("CFG（{{cfg}}）", inputFor("cfg", "number")),
    settingField("采样器（{{samplerName}}）", inputFor("samplerName")),
    settingField("调度器（{{scheduler}}）", inputFor("scheduler")),
    settingField("降噪（{{denoise}}）", inputFor("denoise", "number"))
  );
  const prompt = document.createElement("textarea");
  prompt.rows = 8; prompt.value = settings().summaryPrompt; prompt.placeholder = "使用 {{message}} 代表当前 AI 回复";
  prompt.addEventListener("input", () => { settings().summaryPrompt = prompt.value; save(); });
  content.append(settingField("LLM 场景总结提示词（{{message}} = 当前 AI 回复）", prompt));
  const workflow = document.createElement("textarea");
  workflow.rows = 14; workflow.value = settings().workflow; workflow.spellcheck = false;
  workflow.addEventListener("change", () => { settings().workflow = workflow.value; save(); });
  content.append(settingField("ComfyUI API 工作流 JSON（可使用 {{prompt}}、{{negativePrompt}} 及上方参数占位符）", workflow));
  const test = document.createElement("button");
  test.type = "button"; test.className = "menu_button"; test.textContent = "验证工作流正向节点";
  test.addEventListener("click", () => { try { workflowWithPrompt("scene draw connection test"); notify("success", "工作流 JSON 和正向提示词节点有效。"); } catch (error) { notify("error", error.message); } });
  content.append(test); panel.append(content);
  (document.querySelector("#extensions_settings") || document.querySelector("#extensions_settings2") || document.body).append(panel);
}
function start() {
  settings(); debug("插件初始化", { version: "3.1.2" }); bindGenerationClickHandler(); bindSidebarTracking(); ensureSidebar(); addSettings(); decorateMessages();
  setTimeout(updateActiveMessage);
  new MutationObserver(decorateMessages).observe(document.body, { childList: true, subtree: true });
  eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, () => setTimeout(() => { decorateMessages(); updateActiveMessage(); }));
}
jQuery(start);
