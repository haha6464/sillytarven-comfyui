import { extension_settings } from "../../../extensions.js";
import { chat, eventSource, event_types, saveChatConditional, saveSettingsDebounced } from "../../../../script.js";

const extensionName = "st-chatu8";
const clientId = "scene-draw-" + (crypto.randomUUID?.() || Math.random().toString(36).slice(2));

// Supplied Krea workflow, already in ComfyUI API format.
const defaultWorkflow = {
  "3": { "inputs": { "text": "<lora:LiRuinan_v2:1.00>, <lora:SNOFS_krea_v1_2:1.00>, <lora:penis_size_krea2_v2_loraholic:-4.00:-4.00>, <lora:breast_size_v2_krea2_loraholic:-1.00>", "loras": { "__value__": [{ "name": "LiRuinan_v2", "strength": "1.00", "active": true, "expanded": false, "clipStrength": "1.00", "selected": false, "locked": false }, { "name": "breast_size_v2_krea2_loraholic", "strength": "-1.00", "active": true, "expanded": false, "clipStrength": "-1.00", "selected": false, "locked": false }, { "name": "penis_size_krea2_v2_loraholic", "strength": "-3.00", "active": true, "expanded": false, "clipStrength": "-3.00", "selected": false, "locked": false }, { "name": "SNOFS_krea_v1_2", "strength": 1, "active": true, "expanded": false, "clipStrength": 1, "selected": false, "locked": false }] }, "model": ["10", 0], "clip": ["6", 0] }, "class_type": "Lora Loader (LoraManager)" },
  "5": { "inputs": { "text": "", "clip": ["3", 1] }, "class_type": "CLIPTextEncode" },
  "6": { "inputs": { "clip_name": "qwen3VLInstruct4bHeretic_int8Convrot.safetensors", "type": "krea2", "device": "default" }, "class_type": "CLIPLoader" },
  "7": { "inputs": { "vae_name": "qwen_image_vae.safetensors" }, "class_type": "VAELoader" },
  "8": { "inputs": { "text": "马赛克, mosaic, censored, 模糊，低分辨率，低质量图像，扭曲的肢体，诡异的外观，丑陋，噪点，网格感，JPEG压缩条纹，异常的肢体，水印，乱码，意义不明的字符", "clip": ["3", 1] }, "class_type": "CLIPTextEncode" },
  "9": { "inputs": { "seed": 31982231011750 }, "class_type": "Seed (rgthree)" },
  "10": { "inputs": { "unet_name": "krea2_turbo_fp8_scaled.safetensors", "weight_dtype": "default" }, "class_type": "UNETLoader" },
  "11": { "inputs": { "conditioning": ["5", 0] }, "class_type": "ConditioningZeroOut" },
  "12": { "inputs": { "samples": ["14", 0], "vae": ["7", 0] }, "class_type": "VAEDecode" },
  "13": { "inputs": { "width": 1024, "height": 1024, "batch_size": 1 }, "class_type": "EmptyLatentImage" },
  "14": { "inputs": { "seed": ["9", 0], "steps": 8, "cfg": 1, "sampler_name": "er_sde", "scheduler": "simple", "denoise": 1, "model": ["3", 0], "positive": ["5", 0], "negative": ["11", 0], "latent_image": ["13", 0] }, "class_type": "KSampler" },
  "15": { "inputs": { "filename_prefix": "Krea2", "images": ["12", 0] }, "class_type": "SaveImage" }
};

const defaults = {
  enabled: true, comfyUrl: "http://127.0.0.1:8188", useComfyProxy: true,
  workflow: JSON.stringify(defaultWorkflow, null, 2), positiveNodeId: "5", positiveInputName: "text",
  llmBaseUrl: "", llmApiKey: "", llmModel: "", llmUseProxy: true, llmTemperature: 0.3,
  summaryPrompt: "你是绘图提示词整理助手。只根据下面这一条 AI 回复提炼画面场景，保留人物、动作、服饰、环境、镜头和光线；输出适合 ComfyUI 的简洁正向提示词。不要解释、不要加引号、不要虚构未出现的细节。\n\nAI 本轮回复：\n{{message}}"
};

function settings() {
  extension_settings[extensionName] ||= {};
  Object.entries(defaults).forEach(([key, value]) => extension_settings[extensionName][key] ??= value);
  return extension_settings[extensionName];
}
function save() { saveSettingsDebounced(); }
function headers() { return { "Content-Type": "application/json", "X-CSRF-Token": window.token }; }
function notify(kind, message) {
  if (window.toastr?.[kind]) window.toastr[kind](message, "本轮生图");
  else console[kind === "error" ? "error" : "log"]("[本轮生图] " + message);
}
function cleanText(value) {
  return String(value || "").replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/<thinking>[\s\S]*?<\/thinking>/gi, "").replace(/<\/??image[^>]*>/gi, "").trim();
}

async function summarizeTurn(text) {
  const conf = settings();
  if (!conf.llmBaseUrl || !conf.llmApiKey || !conf.llmModel) throw new Error("请先填写 LLM Base URL、API Key 和模型名称。");
  const prompt = conf.summaryPrompt.includes("{{message}}") ? conf.summaryPrompt.replaceAll("{{message}}", text) : conf.summaryPrompt + "\n\nAI 本轮回复：\n" + text;
  let url, requestHeaders, body;
  if (conf.llmUseProxy) {
    url = "/api/backends/chat-completions/generate";
    requestHeaders = headers();
    body = { chat_completion_source: "custom", custom_url: conf.llmBaseUrl.replace(/\/$/, ""), custom_include_headers: 'Authorization: "Bearer ' + conf.llmApiKey + '"', model: conf.llmModel, messages: [{ role: "user", content: prompt }], temperature: Number(conf.llmTemperature), stream: false };
  } else {
    url = conf.llmBaseUrl.replace(/\/$/, "") + "/chat/completions";
    requestHeaders = { "Content-Type": "application/json", "Authorization": "Bearer " + conf.llmApiKey };
    body = { model: conf.llmModel, messages: [{ role: "user", content: prompt }], temperature: Number(conf.llmTemperature), stream: false };
  }
  const response = await fetch(url, { method: "POST", headers: requestHeaders, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) throw new Error(data.error?.message || data.message || "LLM 请求失败（" + response.status + "）");
  const result = cleanText(data.choices?.[0]?.message?.content);
  if (!result) throw new Error("LLM 没有返回可用的场景提示词。");
  return result;
}

function workflowWithPrompt(prompt) {
  const conf = settings();
  let workflow;
  try { workflow = JSON.parse(conf.workflow); } catch (error) { throw new Error("工作流 JSON 无效：" + error.message); }
  const node = workflow[conf.positiveNodeId];
  if (!node?.inputs || !(conf.positiveInputName in node.inputs)) throw new Error("找不到正向提示词位置：节点 " + conf.positiveNodeId + " 的 " + conf.positiveInputName + "。");
  node.inputs[conf.positiveInputName] = prompt;
  return workflow;
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

async function generateDirect(workflow) {
  const base = settings().comfyUrl.replace(/\/$/, "");
  const response = await fetch(base + "/prompt", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ client_id: clientId, prompt: workflow }) });
  const queued = await response.json().catch(() => ({}));
  if (!response.ok || !queued.prompt_id) throw new Error(queued.error?.message || "ComfyUI 提交失败（" + response.status + "）");
  const deadline = Date.now() + 600000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const history = await fetch(base + "/history/" + encodeURIComponent(queued.prompt_id)).then((r) => r.json()).catch(() => ({}));
    const record = history[queued.prompt_id];
    if (!record) continue;
    if (record.status?.status_str === "error") throw new Error(record.status?.exception_message || "ComfyUI 工作流执行失败。");
    const file = outputImage(record);
    if (!file) continue;
    const params = new URLSearchParams({ filename: file.filename, subfolder: file.subfolder || "", type: file.type || "output" });
    const imageResponse = await fetch(base + "/view?" + params);
    if (!imageResponse.ok) throw new Error("ComfyUI 已完成，但无法下载图片。");
    return blobToDataUrl(await imageResponse.blob());
  }
  throw new Error("等待 ComfyUI 图片超时（10 分钟）。");
}
async function generateProxy(workflow) {
  const response = await fetch("/api/sd/comfy/generate", { method: "POST", headers: headers(), body: JSON.stringify({ url: settings().comfyUrl, prompt: JSON.stringify({ client_id: clientId, prompt: workflow }) }) });
  const raw = await response.text();
  if (!response.ok) throw new Error(raw || "ComfyUI 代理请求失败（" + response.status + "）");
  let data;
  try { data = JSON.parse(raw); } catch { data = { data: raw, format: "png" }; }
  if (!data.data) throw new Error(data.error?.message || "酒馆代理没有返回图片数据。");
  return "data:image/" + (data.format || "png") + ";base64," + data.data;
}
async function generateImage(prompt) {
  if (!settings().comfyUrl) throw new Error("请先填写 ComfyUI 地址。");
  const workflow = workflowWithPrompt(prompt);
  return settings().useComfyProxy ? generateProxy(workflow) : generateDirect(workflow);
}

function renderImage(mesId, imageUrl, prompt) {
  const mes = document.querySelector('.mes[mesid="' + CSS.escape(String(mesId)) + '"]');
  if (!mes) return;
  mes.querySelector(".scene-draw-result")?.remove();
  const result = document.createElement("details");
  result.className = "scene-draw-result";
  result.open = true;
  const summary = document.createElement("summary");
  summary.textContent = "本轮生成图片（点击收起）";
  const image = document.createElement("img");
  image.src = imageUrl; image.alt = prompt; image.title = prompt;
  result.append(summary, image);
  const text = mes.querySelector(".mes_text");
  if (text) text.after(result); else mes.append(result);
}
async function runForMessage(mesId, button) {
  if (!settings().enabled || button.disabled) return;
  const label = button.querySelector("span");
  button.disabled = true;
  try {
    const message = chat[Number(mesId)];
    if (!message || message.is_user || message.is_system) throw new Error("请在一条 AI 回复上点击生成图片。");
    const text = cleanText(message.mes);
    if (!text) throw new Error("这条 AI 回复没有可用于总结的文本。");
    label.textContent = "总结场景…";
    const prompt = await summarizeTurn(text);
    label.textContent = "ComfyUI 生图…";
    const image = await generateImage(prompt);
    message.extra ||= {};
    message.extra.sceneDrawImage = image;
    message.extra.sceneDrawPrompt = prompt;
    saveChatConditional();
    renderImage(mesId, image, prompt);
    notify("success", "图片已生成。");
  } catch (error) {
    console.error("[本轮生图]", error);
    notify("error", error.message || String(error));
  } finally {
    label.textContent = "生成图片";
    button.disabled = false;
  }
}
function decorateMessage(mes) {
  const mesId = mes.getAttribute("mesid");
  if (mesId === null || mes.querySelector(".scene-draw-button")) return;
  const message = chat[Number(mesId)];
  if (!message || message.is_user || message.is_system) return;
  const button = document.createElement("button");
  button.type = "button"; button.className = "menu_button scene-draw-button"; button.title = "总结此条 AI 回复并生成图片";
  button.innerHTML = '<i class="fa-solid fa-image"></i><span>生成图片</span>';
  button.addEventListener("click", () => runForMessage(mesId, button));
  (mes.querySelector(".mes_buttons") || mes).append(button);
  if (message.extra?.sceneDrawImage) renderImage(mesId, message.extra.sceneDrawImage, message.extra.sceneDrawPrompt || "");
}
function decorateMessages() { document.querySelectorAll(".mes[mesid]").forEach(decorateMessage); }

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
function addSettings() {
  if (document.querySelector("#scene-draw-settings")) return;
  const panel = document.createElement("details");
  panel.id = "scene-draw-settings"; panel.className = "inline-drawer";
  panel.innerHTML = '<summary><i class="fa-solid fa-image"></i> 本轮生图设置</summary><p>点击每条 AI 回复上的“生成图片”后，只会将该条回复交给 LLM 总结并生成。</p>';
  const content = document.createElement("div");
  content.className = "scene-draw-settings-content";
  content.append(settingField("ComfyUI 地址", inputFor("comfyUrl")), settingField("LLM Base URL（含 /v1）", inputFor("llmBaseUrl")), settingField("LLM API Key", inputFor("llmApiKey", "password")), settingField("LLM 模型", inputFor("llmModel")), settingField("Temperature", inputFor("llmTemperature", "number")), settingField("正向提示词节点 ID", inputFor("positiveNodeId")), settingField("正向提示词字段", inputFor("positiveInputName")));
  [["useComfyProxy", "通过酒馆代理连接 ComfyUI"], ["llmUseProxy", "通过酒馆代理调用 LLM"]].forEach(([key, label]) => {
    const input = document.createElement("input");
    input.type = "checkbox"; input.checked = settings()[key];
    input.addEventListener("change", () => { settings()[key] = input.checked; save(); });
    content.append(settingField(label, input));
  });
  const prompt = document.createElement("textarea");
  prompt.rows = 8; prompt.value = settings().summaryPrompt; prompt.placeholder = "使用 {{message}} 代表当前 AI 回复";
  prompt.addEventListener("input", () => { settings().summaryPrompt = prompt.value; save(); });
  content.append(settingField("LLM 场景总结提示词（{{message}} = 当前 AI 回复）", prompt));
  const workflow = document.createElement("textarea");
  workflow.rows = 14; workflow.value = settings().workflow; workflow.spellcheck = false;
  workflow.addEventListener("change", () => { settings().workflow = workflow.value; save(); });
  content.append(settingField("ComfyUI API 工作流 JSON", workflow));
  const test = document.createElement("button");
  test.type = "button"; test.className = "menu_button"; test.textContent = "验证工作流正向节点";
  test.addEventListener("click", () => { try { workflowWithPrompt("scene draw connection test"); notify("success", "工作流 JSON 和正向提示词节点有效。"); } catch (error) { notify("error", error.message); } });
  content.append(test); panel.append(content);
  (document.querySelector("#extensions_settings") || document.querySelector("#extensions_settings2") || document.body).append(panel);
}
function start() {
  settings(); addSettings(); decorateMessages();
  new MutationObserver(decorateMessages).observe(document.body, { childList: true, subtree: true });
  eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, () => setTimeout(decorateMessages));
}
jQuery(start);
