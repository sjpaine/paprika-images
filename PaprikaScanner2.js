// Recipe Scanner for Paprika
// ============================
// Extract recipes from photos and create .paprikarecipe files
// for import into Paprika Recipe Manager on iOS.
//
// Setup:
// 1. Install Scriptable from the App Store
// 2. Add this script to Scriptable
// 3. Get a free API key at openrouter.ai
// 4. Run the script — auto-detects API key from clipboard
// 5. Pick a recipe photo → enter cookbook/page → confirm → open in Paprika!

const CONFIG = {
  openRouterUrl: "https://openrouter.ai/api/v1/chat/completions",
  visionModels: [
    "google/gemma-4-31b-it:free",
    "baidu/qianfan-ocr-fast:free",
    "nvidia/nemotron-nano-12b-v2-vl:free",
    "google/gemma-4-26b-a4b-it:free",
    "google/gemma-3-27b-it:free"
  ],
  textModels: [
    "nvidia/nemotron-3-super-120b-a12b:free",
    "qwen/qwen3-next-80b-a3b-instruct:free",
    "inclusionai/ling-2.6-1t:free",
    "meta-llama/llama-3.3-70b-instruct:free",
    "google/gemma-4-31b-it:free"
  ],
  keychainKey: "openrouter_api_key",
  maxImageDimension: 1200,
  ocrConfidenceThreshold: 0.5
}

// ── Design tokens (Shapecast-inspired warm craft palette) ──

const C = {
  ink: new Color("#1a1714"),
  paper: new Color("#f5f0e8"),
  warm: new Color("#c8a96e"),
  faint: new Color("#e8e0d0"),
  muted: new Color("#8c8070"),
  accent: new Color("#7a4f2e"),
  white: new Color("#ffffff"),
  cream: new Color("#faf7f0"),
  sectionBg: new Color("#f0ebe0"),
  dividerDark: new Color("#d4c9b8"),
  green: new Color("#5a7a4a"),
  red: new Color("#a04040")
}

// ── Main Flow (Alert-based menu, loops after each scan) ──

async function mainFlow() {
  while (true) {
    let hasKey = Keychain.contains(CONFIG.keychainKey)

    let menu = new Alert()
    menu.title = "Recipe Scanner"
    menu.message = "Photo \u2192 Paprika in seconds"
    menu.addAction("Scan Recipe")
    menu.addAction("API Key" + (hasKey ? " \u2705" : ""))
    menu.addCancelAction("Done")
    let choice = await menu.present()

    if (choice === 0) {
      await scanFlow()
    } else if (choice === 1) {
      await configureApiKey()
    } else {
      break
    }
  }
}

// ── Scan Flow (Alert-based until recipe is ready, then UITable preview) ──

async function scanFlow() {
  let apiKey = Keychain.contains(CONFIG.keychainKey) ? Keychain.get(CONFIG.keychainKey) : null
  if (!apiKey) {
    apiKey = await setupApiKey()
    if (!apiKey) return
  }

  let image = await selectImage()
  if (!image) return

  let sourceOverride = await getSourceInfo()
  let base64 = imageToBase64(image)

  // Step 1: On-device OCR (instant, free, offline)
  let loader = showLoading("Scanning Text", "Reading text from photo\u2026")
  let ocrResult = ocrImage(image)
  await hideLoading(loader)

  // Step 2: Choose path based on OCR confidence
  let responseText
  if (ocrResult.confidence >= CONFIG.ocrConfidenceThreshold && ocrResult.text.length > 20) {
    // Good OCR — use fast text-only LLM call
    loader = showLoading("Analyzing Recipe", "This may take a minute or two\u2026")
    try {
      responseText = await callOpenRouterText(apiKey, ocrResult.text)
    } catch(apiErr) {
      // Text LLM failed — try vision as fallback
      await hideLoading(loader)
      loader = showLoading("Retrying with Vision", "Text extraction failed, trying visual analysis\u2026")
      try {
        responseText = await callOpenRouterVision(apiKey, base64)
      } catch(visionErr) {
        await hideLoading(loader)
        await showAlert("API Error", visionErr.message)
        return
      }
    }
  } else {
    // Poor OCR — use vision model directly
    loader = showLoading("Analyzing Recipe", "This may take a minute or two\u2026")
    try {
      responseText = await callOpenRouterVision(apiKey, base64)
    } catch(apiErr) {
      await hideLoading(loader)
      await showAlert("API Error", apiErr.message)
      return
    }
  }

  let recipe
  try {
    recipe = parseRecipe(responseText)
  } catch(parseErr) {
    await hideLoading(loader)
    await showAlert("Parse Error", parseErr.message)
    return
  }

  await hideLoading(loader)

  let confirmed = await showRecipePreview(recipe, sourceOverride, image)
  if (!confirmed) return

  let paprika = toPaprika(recipe, base64, sourceOverride)
  let paprikaJson = JSON.stringify(paprika, Object.keys(paprika).sort())
  let gzipped = gzip(paprikaJson)

  await saveAndShare(gzipped, paprika.name)

  let done = new Alert()
  done.title = "Import Complete"
  done.message = paprika.name + "\nOpen in Paprika to save this recipe."
  done.addAction("OK")
  await done.present()
}

// ── Section label helper ──

function addSectionLabel(table, text) {
  let row = new UITableRow()
  row.height = 32
  row.backgroundColor = C.sectionBg
  let cell = row.addText(text.toUpperCase())
  cell.titleFont = Font.boldSystemFont(11)
  cell.titleColor = C.muted
  cell.widthWeight = 100
  cell.leftAligned()
  table.addRow(row)
}

// ── Recipe Preview (Shapecast-inspired card layout) ──

async function showRecipePreview(recipe, sourceOverride, image) {
  return new Promise(function(resolve) {
    let table = new UITable()
    table.showSeparators = false
    let finalSource = sourceOverride || recipe.source || ""

    // Hero header
    if (image) {
      let imgRow = new UITableRow()
      imgRow.height = 200
      imgRow.backgroundColor = C.paper
      let imgCell = imgRow.addImage(image)
      imgCell.widthWeight = 100
      table.addRow(imgRow)
    }

    // Title card
    let nameRow = new UITableRow()
    nameRow.height = 64
    nameRow.backgroundColor = C.white
    let nameCell = nameRow.addText(recipe.name || "Untitled Recipe", recipe.description || "")
    nameCell.titleFont = Font.boldSystemFont(20)
    nameCell.titleColor = C.accent
    nameCell.subtitleFont = Font.systemFont(13)
    nameCell.subtitleColor = C.muted
    nameCell.widthWeight = 100
    table.addRow(nameRow)

    // Warm divider
    let dw = new UITableRow()
    dw.height = 2
    dw.backgroundColor = C.warm
    dw.addText("")
    table.addRow(dw)

    // Details
    addSectionLabel(table, "Details")
    let details = []
    if (recipe.servings) details.push(["Servings", recipe.servings])
    if (recipe.prep_time) details.push(["Prep", recipe.prep_time])
    if (recipe.cook_time) details.push(["Cook", recipe.cook_time])
    if (recipe.total_time) details.push(["Total", recipe.total_time])
    if (finalSource) details.push(["Source", finalSource])
    for (let d of details) {
      let row = new UITableRow()
      row.backgroundColor = C.white
      row.height = 36
      let labelCell = row.addText(d[0])
      labelCell.titleFont = Font.systemFont(13)
      labelCell.titleColor = C.muted
      labelCell.widthWeight = 30
      labelCell.leftAligned()
      let valCell = row.addText(d[1])
      valCell.titleFont = Font.mediumSystemFont(13)
      valCell.titleColor = C.ink
      valCell.widthWeight = 70
      table.addRow(row)
    }

    // Ingredients
    let ingredients = (recipe.ingredients || "").replace(/\\n/g, "\n").split("\n").filter(function(l) { return l.trim() })
    if (ingredients.length > 0) {
      let id = new UITableRow()
      id.height = 2
      id.backgroundColor = C.faint
      id.addText("")
      table.addRow(id)

      addSectionLabel(table, "Ingredients \u00b7 " + ingredients.length)
      for (let ing of ingredients) {
        let row = new UITableRow()
        row.backgroundColor = C.cream
        row.height = 32
        let bulletCell = row.addText("\u2022")
        bulletCell.titleFont = Font.systemFont(12)
        bulletCell.titleColor = C.warm
        bulletCell.widthWeight = 6
        bulletCell.leftAligned()
        let cell = row.addText(ing.trim())
        cell.titleFont = Font.systemFont(14)
        cell.titleColor = C.ink
        cell.widthWeight = 94
        table.addRow(row)
      }
    }

    // Directions
    let directions = (recipe.directions || "").replace(/\\n/g, "\n").split("\n").filter(function(l) { return l.trim() })
    if (directions.length > 0) {
      let dd = new UITableRow()
      dd.height = 2
      dd.backgroundColor = C.faint
      dd.addText("")
      table.addRow(dd)

      addSectionLabel(table, "Directions")
      for (let i = 0; i < directions.length; i++) {
        let row = new UITableRow()
        row.backgroundColor = C.white
        row.height = 36
        let numCell = row.addText(String(i + 1))
        numCell.titleFont = Font.boldSystemFont(14)
        numCell.titleColor = C.accent
        numCell.widthWeight = 8
        numCell.leftAligned()
        let stepCell = row.addText(directions[i].trim())
        stepCell.titleFont = Font.systemFont(14)
        stepCell.titleColor = C.ink
        stepCell.widthWeight = 92
        table.addRow(row)
      }
    }

    // Notes
    let notes = (recipe.notes || "").replace(/\\n/g, "\n").trim()
    if (notes) {
      let nd = new UITableRow()
      nd.height = 2
      nd.backgroundColor = C.faint
      nd.addText("")
      table.addRow(nd)

      addSectionLabel(table, "Notes")
      let notesRow = new UITableRow()
      notesRow.backgroundColor = C.cream
      let notesCell = notesRow.addText(notes)
      notesCell.titleFont = Font.systemFont(13)
      notesCell.titleColor = C.muted
      notesCell.widthWeight = 100
      table.addRow(notesRow)
    }

    // Create button
    let spacerRow = new UITableRow()
    spacerRow.height = 16
    spacerRow.backgroundColor = C.paper
    spacerRow.addText("")
    table.addRow(spacerRow)

    let createRow = new UITableRow()
    createRow.height = 52
    createRow.backgroundColor = C.accent
    let createCell = createRow.addText("Create Paprika File")
    createCell.titleFont = Font.boldSystemFont(18)
    createCell.titleColor = C.white
    createCell.widthWeight = 100
    createCell.centerAligned()
    createRow.onSelect = function() { resolve(true) }
    createRow.dismissOnSelect = true
    table.addRow(createRow)

    // Cancel
    let cancelRow = new UITableRow()
    cancelRow.height = 44
    cancelRow.backgroundColor = C.paper
    let cancelCell = cancelRow.addText("Cancel")
    cancelCell.titleFont = Font.systemFont(15)
    cancelCell.titleColor = C.muted
    cancelCell.widthWeight = 100
    cancelCell.centerAligned()
    cancelRow.onSelect = function() { resolve(false) }
    cancelRow.dismissOnSelect = true
    table.addRow(cancelRow)

    table.present()
  })
}

// ── API Key Configuration ──

async function configureApiKey() {
  let currentKey = Keychain.contains(CONFIG.keychainKey) ? Keychain.get(CONFIG.keychainKey) : ""
  let alert = new Alert()
  alert.title = "API Key"
  alert.message = currentKey ? "Current: " + currentKey.substring(0, 14) + "..." : "Enter your OpenRouter API key.\nGet one free at openrouter.ai"
  alert.addTextField(currentKey ? currentKey : "sk-or-v1-...")
  alert.addAction("Save")
  alert.addAction("Clear")
  alert.addCancelAction("Cancel")
  let choice = await alert.present()
  if (choice === 0) {
    let key = alert.textFieldValue(0).trim()
    if (key && key.startsWith("sk-")) {
      Keychain.set(CONFIG.keychainKey, key)
      await showAlert("Saved", "API key saved to Keychain.")
    } else if (key) {
      await showAlert("Invalid Key", "Key should start with 'sk-'.")
    }
  } else if (choice === 1) {
    if (Keychain.contains(CONFIG.keychainKey)) {
      Keychain.remove(CONFIG.keychainKey)
      await showAlert("Cleared", "API key removed.")
    }
  }
}

async function setupApiKey() {
  let clip = ""
  try { clip = Pasteboard.general.string || "" } catch(e) {}

  if (clip.trim().startsWith("sk-")) {
    let key = clip.trim()
    let alert = new Alert()
    alert.title = "API Key Detected"
    alert.message = "Found an OpenRouter key on your clipboard.\n\n" + key.substring(0, 14) + "...\n\nSaved securely in iOS Keychain."
    alert.addAction("Use This Key")
    alert.addCancelAction("Enter Manually")
    if ((await alert.present()) === 0) {
      Keychain.set(CONFIG.keychainKey, key)
      return key
    }
  }

  let alert = new Alert()
  alert.title = "API Key"
  alert.message = "Enter your OpenRouter API key.\n\nGet one free at openrouter.ai\n\nTip: Copy the key on your Mac \u2014 it will auto-detect from clipboard."
  alert.addTextField("sk-or-v1-...")
  alert.addAction("Save")
  alert.addCancelAction("Cancel")
  if ((await alert.present()) === -1) return null
  let key = alert.textFieldValue(0).trim()
  if (!key) return null
  Keychain.set(CONFIG.keychainKey, key)
  return key
}

// ── Image Selection ──

async function selectImage() {
  let alert = new Alert()
  alert.title = "Choose Image"
  alert.message = "Where is your recipe photo?"
  alert.addAction("Photo Library")
  alert.addAction("Camera")
  alert.addCancelAction("Cancel")
  let choice = await alert.present()
  if (choice === -1) return null
  try {
    let img = choice === 0 ? await Photos.fromLibrary() : await Photos.fromCamera()
    if (!img) { await showAlert("No Image", "No image was selected."); return null }
    return img
  } catch(e) { await showAlert("Error", "Could not select image: " + e.message); return null }
}

function imageToBase64(image) {
  let maxDim = CONFIG.maxImageDimension
  let w = image.size.width, h = image.size.height
  let scale = Math.min(1, maxDim / Math.max(w, h))
  let newW = Math.round(w * scale), newH = Math.round(h * scale)
  let ctx = new DrawContext()
  ctx.size = new Size(newW, newH)
  ctx.drawImageInRect(image, new Rect(0, 0, newW, newH))
  let resizedImage = ctx.getImage()
  let data = Data.fromJPEG(resizedImage, 0.8)
  return data.toBase64String()
}

// ── Recipe Source Input ──

async function getSourceInfo() {
  let alert = new Alert()
  alert.title = "Recipe Source"
  alert.message = "Optional: cookbook name and page number.\nThis becomes the source field in Paprika."
  alert.addTextField("Cookbook name")
  alert.addTextField("Page number")
  alert.addAction("Continue")
  alert.addCancelAction("Skip")
  let choice = await alert.present()
  if (choice === -1) return null
  let cookbook = alert.textFieldValue(0).trim()
  let page = alert.textFieldValue(1).trim()
  if (!cookbook && !page) return null
  if (cookbook && page) return cookbook + " \u2014 p." + page
  if (cookbook) return cookbook
  return "p. " + page
}

// ── On-Device OCR (iOS Vision framework via ObjC bridge) ──

function ocrImage(image) {
  try {
    let vnImage = $.VNImageRequestHandler.alloc().initWithCGImageOptions(image.cgImage, $.NSDictionary.dictionary)
    let request = $.VNRecognizeTextRequest.alloc().init()
    request.recognitionLevel = $.VNRequestTextRecognitionLevelAccurate
    request.recognitionLanguages = $.NSArray.arrayWithObject$("en-US")
    request.usesLanguageCorrection = true
    vnImage.performRequestsError([request], null)
    let observations = request.results
    if (!observations || observations.count === 0) {
      return { text: "", confidence: 0 }
    }
    let lines = []
    let totalConf = 0
    for (let i = 0; i < observations.count; i++) {
      let obs = observations.objectAtIndex(i)
      lines.push(obs.stringValue)
      totalConf += obs.confidence
    }
    let avgConf = totalConf / observations.count
    return { text: lines.join("\n"), confidence: avgConf }
  } catch(e) {
    return { text: "", confidence: 0 }
  }
}

// ── OpenRouter Vision API ──

const EXTRACT_VISION_PROMPT = `You are a recipe extraction assistant. Extract the recipe from this photo and return ONLY a JSON object with these exact fields:

{
  "name": "Recipe title",
  "description": "A brief one-line description of the dish",
  "ingredients": "Each ingredient on a new line separated by \\n",
  "directions": "Each step on a new line separated by \\n",
  "servings": "Servings or yield e.g. '4 servings'",
  "prep_time": "Prep time e.g. '15 mins' or ''",
  "cook_time": "Cook time e.g. '30 mins' or ''",
  "total_time": "Total time e.g. '45 mins' or ''",
  "notes": "Tips, variations, or notes, or ''",
  "nutritional_info": "Nutritional info if present, or ''",
  "categories": ["Category1", "Category2"],
  "source": "Source name if visible, or ''",
  "source_url": "URL if visible, or ''"
}

Use empty strings for missing text fields and empty arrays for categories.
Put each ingredient and each direction step on a new line using \\n.
Return ONLY the JSON, no markdown, no explanation.`

async function callOpenRouterVision(apiKey, base64Image) {
  let lastError = null
  for (let i = 0; i < CONFIG.visionModels.length; i++) {
    let model = CONFIG.visionModels[i]
    log("Vision: trying " + model)
    let req = new Request(CONFIG.openRouterUrl)
    req.method = "POST"
    req.headers = {
      "Authorization": "Bearer " + apiKey,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://scriptable.app",
      "X-OpenRouter-Title": "Paprika Recipe Scanner"
    }
    req.timeoutInterval = 120
    req.body = JSON.stringify({
      model: model,
      messages: [{
        role: "user",
        content: [
          { type: "text", text: EXTRACT_VISION_PROMPT },
          { type: "image_url", image_url: { url: "data:image/jpeg;base64," + base64Image } }
        ]
      }]
    })
    let response
    try { response = await req.loadJSON() } catch(e) { lastError = new Error("Network error: " + e.message); continue }
    let status = req.response.statusCode
    if (status === 429) { lastError = new Error("Rate limited on " + model); continue }
    if (status !== 200) {
      let msg = response.error ? (response.error.message || JSON.stringify(response.error)) : JSON.stringify(response).substring(0, 200)
      lastError = new Error("API error (" + status + "): " + msg)
      if (status >= 400 && status < 500 && status !== 429) break
      continue
    }
    if (!response.choices || !response.choices[0] || !response.choices[0].message || !response.choices[0].message.content) {
      lastError = new Error("Empty response from " + model); break
    }
    log("Vision: success with " + model)
    return response.choices[0].message.content
  }
  throw lastError || new Error("All vision models failed. Try again later.")
}

// ── OpenRouter Text-Only API ──

const EXTRACT_TEXT_PROMPT = `You are a recipe extraction assistant. Below is text that was OCR'd from a recipe photo. There may be OCR errors — fix obvious ones. Extract the recipe and return ONLY a JSON object with these exact fields:

{
  "name": "Recipe title",
  "description": "A brief one-line description of the dish",
  "ingredients": "Each ingredient on a new line separated by \\n",
  "directions": "Each step on a new line separated by \\n",
  "servings": "Servings or yield e.g. '4 servings'",
  "prep_time": "Prep time e.g. '15 mins' or ''",
  "cook_time": "Cook time e.g. '30 mins' or ''",
  "total_time": "Total time e.g. '45 mins' or ''",
  "notes": "Tips, variations, or notes, or ''",
  "nutritional_info": "Nutritional info if present, or ''",
  "categories": ["Category1", "Category2"],
  "source": "Source name if visible, or ''",
  "source_url": "URL if visible, or ''"
}

Use empty strings for missing text fields and empty arrays for categories.
Put each ingredient and each direction step on a new line using \\n.
Return ONLY the JSON, no markdown, no explanation.

OCR text:
`

async function callOpenRouterText(apiKey, ocrText) {
  let lastError = null
  for (let i = 0; i < CONFIG.textModels.length; i++) {
    let model = CONFIG.textModels[i]
    log("Text: trying " + model)
    let req = new Request(CONFIG.openRouterUrl)
    req.method = "POST"
    req.headers = {
      "Authorization": "Bearer " + apiKey,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://scriptable.app",
      "X-OpenRouter-Title": "Paprika Recipe Scanner"
    }
    req.timeoutInterval = 120
    req.body = JSON.stringify({
      model: model,
      messages: [{
        role: "user",
        content: EXTRACT_TEXT_PROMPT + ocrText
      }]
    })
    let response
    try { response = await req.loadJSON() } catch(e) { lastError = new Error("Network error: " + e.message); continue }
    let status = req.response.statusCode
    if (status === 429) { lastError = new Error("Rate limited on " + model); continue }
    if (status !== 200) {
      let msg = response.error ? (response.error.message || JSON.stringify(response.error)) : JSON.stringify(response).substring(0, 200)
      lastError = new Error("API error (" + status + "): " + msg)
      if (status >= 400 && status < 500 && status !== 429) break
      continue
    }
    if (!response.choices || !response.choices[0] || !response.choices[0].message || !response.choices[0].message.content) {
      lastError = new Error("Empty response from " + model); break
    }
    log("Text: success with " + model)
    return response.choices[0].message.content
  }
  throw lastError || new Error("All text models failed.")
}

// ── Recipe Parsing ──

function parseRecipe(text) {
  let match = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/)
  if (match) text = match[1]
  match = text.match(/\{[\s\S]*\}/)
  if (!match) throw new Error("No JSON found in model response.\n\n" + text.substring(0, 200))
  let recipe
  try { recipe = JSON.parse(match[0]) } catch(e) { throw new Error("Invalid JSON: " + e.message) }
  if (!recipe.name) throw new Error("Recipe name not found in extracted data")
  return recipe
}

// ── SHA-256 ──

var sha256K = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2]

function sha256Hex(str) {
  if (typeof str === "string") {
    var e = []
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i)
      if (c < 0x80) e.push(c)
      else if (c < 0x800) { e.push(0xC0|(c>>6)); e.push(0x80|(c&0x3F)) }
      else if (c >= 0xD800 && c <= 0xDBFF) { var lo = str.charCodeAt(++i); var cp = ((c-0xD800)<<10)+(lo-0xDC00)+0x10000; e.push(0xF0|(cp>>18)); e.push(0x80|((cp>>12)&0x3F)); e.push(0x80|((cp>>6)&0x3F)); e.push(0x80|(cp&0x3F)) }
      else { e.push(0xE0|(c>>12)); e.push(0x80|((c>>6)&0x3F)); e.push(0x80|(c&0x3F)) }
    }
    str = e
  }
  var h0=0x6a09e667,h1=0xbb67ae85,h2=0x3c6ef372,h3=0xa54ff53a,h4=0x510e527f,h5=0x9b05688c,h6=0x1f83d9ab,h7=0x5be0cd19
  var ml=str.length,bl=ml*8;str.push(0x80);while(str.length%64!==56)str.push(0);str.push(0,0,0,0);str.push((bl>>>24)&0xFF,(bl>>>16)&0xFF,(bl>>>8)&0xFF,bl&0xFF)
  for(var o=0;o<str.length;o+=64){var w=new Array(64);for(var i=0;i<16;i++){var j=o+i*4;w[i]=(str[j]<<24)|(str[j+1]<<16)|(str[j+2]<<8)|str[j+3]}for(var i=16;i<64;i++){var s0=((w[i-15]>>>7)|(w[i-15]<<25))^((w[i-15]>>>18)|(w[i-15]<<14))^(w[i-15]>>>3);var s1=((w[i-2]>>>17)|(w[i-2]<<15))^((w[i-2]>>>19)|(w[i-2]<<13))^(w[i-2]>>>10);w[i]=(w[i-16]+s0+w[i-7]+s1)|0}
  var a=h0,b=h1,c=h2,d=h3,e=h4,f=h5,g=h6,hh=h7
  for(var i=0;i<64;i++){var S1=((e>>>6)|(e<<26))^((e>>>11)|(e<<21))^((e>>>25)|(e<<7));var ch=(e&f)^((~e)&g);var t1=(hh+S1+ch+sha256K[i]+w[i])|0;var S0=((a>>>2)|(a<<30))^((a>>>13)|(a<<19))^((a>>>22)|(a<<10));var mj=(a&b)^(a&c)^(b&c);var t2=(S0+mj)|0;hh=g;g=f;f=e;e=(d+t1)|0;d=c;c=b;b=a;a=(t1+t2)|0}
  h0=(h0+a)|0;h1=(h1+b)|0;h2=(h2+c)|0;h3=(h3+d)|0;h4=(h4+e)|0;h5=(h5+f)|0;h6=(h6+g)|0;h7=(h7+hh)|0}
  function hex(n){var s="";for(var i=7;i>=0;i--)s+=((n>>>(i*4))&0xF).toString(16);return s}
  return hex(h0)+hex(h1)+hex(h2)+hex(h3)+hex(h4)+hex(h5)+hex(h6)+hex(h7)
}

// ── Paprika Format ──

function toPaprika(recipe, photoBase64, sourceOverride) {
  let uid = uuidString().toUpperCase()
  let photoHash = photoBase64 ? sha256Hex(photoBase64) : ""
  function fix(s) { return (s || "").replace(/\\n/g, "\n") }
  let categories = recipe.categories || []
  if (typeof categories === "string") categories = categories.split(",").map(function(c) { return c.trim() })
  let source = sourceOverride || recipe.source || ""
  let d = {
    categories: categories, cook_time: recipe.cook_time || "",
    created: formatDate(new Date()), description: recipe.description || "",
    difficulty: "", directions: fix(recipe.directions), hash: "",
    image_url: "", ingredients: fix(recipe.ingredients),
    name: recipe.name || "Untitled Recipe", notes: fix(recipe.notes),
    nutritional_info: recipe.nutritional_info || "", photo: photoHash,
    photo_data: photoBase64 || "", photo_hash: photoHash, photo_large: null,
    prep_time: recipe.prep_time || "", rating: 0, servings: recipe.servings || "",
    source: source, source_url: recipe.source_url || "",
    total_time: recipe.total_time || "", uid: uid
  }
  let forHash = Object.assign({}, d); delete forHash.hash
  d.hash = sha256Hex(JSON.stringify(forHash, Object.keys(forHash).sort()))
  return d
}

function uuidString() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function(c) {
    let r = Math.random() * 16 | 0; return (c === "x" ? r : (r & 0x3 | 0x8)).toString(16)
  })
}

function formatDate(d) {
  let y=d.getFullYear(),mo=String(d.getMonth()+1).padStart(2,"0"),da=String(d.getDate()).padStart(2,"0")
  let h=String(d.getHours()).padStart(2,"0"),mi=String(d.getMinutes()).padStart(2,"0"),s=String(d.getSeconds()).padStart(2,"0")
  return y+"-"+mo+"-"+da+" "+h+":"+mi+":"+s
}

// ── Gzip Compression (stored blocks, RFC 1952) ──

function crc32(data) {
  let t = new Uint32Array(256)
  for (let i = 0; i < 256; i++) { let c = i; for (let j = 0; j < 8; j++) { c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1) } t[i] = c }
  let crc = 0xFFFFFFFF
  for (let i = 0; i < data.length; i++) crc = t[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8)
  return (crc ^ 0xFFFFFFFF) >>> 0
}

function utf8Encode(str) {
  let b = []
  for (let i = 0; i < str.length; i++) {
    let c = str.codePointAt(i); if (c > 0xFFFF) i++
    if (c < 0x80) b.push(c)
    else if (c < 0x800) { b.push(0xC0|(c>>6)); b.push(0x80|(c&0x3F)) }
    else if (c < 0x10000) { b.push(0xE0|(c>>12)); b.push(0x80|((c>>6)&0x3F)); b.push(0x80|(c&0x3F)) }
    else { b.push(0xF0|(c>>18)); b.push(0x80|((c>>12)&0x3F)); b.push(0x80|((c>>6)&0x3F)); b.push(0x80|(c&0x3F)) }
  }
  return b
}

function gzip(str) {
  let bytes = utf8Encode(str), len = bytes.length, crc = crc32(new Uint8Array(bytes))
  let o = [0x1F, 0x8B, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xFF]
  let off = 0
  while (off < len) {
    let remaining = len - off, blockLen = Math.min(remaining, 65535), isLast = (off + blockLen >= len)
    o.push(isLast ? 0x01 : 0x00); o.push(blockLen & 0xFF); o.push((blockLen >> 8) & 0xFF)
    let nlen = (0xFFFF - blockLen) & 0xFFFF; o.push(nlen & 0xFF); o.push((nlen >> 8) & 0xFF)
    for (let i = 0; i < blockLen; i++) o.push(bytes[off + i]); off += blockLen
  }
  o.push(crc & 0xFF, (crc >> 8) & 0xFF, (crc >> 16) & 0xFF, (crc >> 24) & 0xFF)
  o.push(len & 0xFF, (len >> 8) & 0xFF, (len >> 16) & 0xFF, (len >> 24) & 0xFF)
  return o
}

// ── File & Share ──

async function saveAndShare(gzipBytes, name) {
  let fm = FileManager.local()
  let safeName = name.replace(/[^a-zA-Z0-9\s\-]/g, "").replace(/\s+/g, "_") || "recipe"
  let path = fm.joinPath(fm.temporaryDirectory(), safeName + ".paprikarecipe")
  fm.write(path, Data.fromBytes(gzipBytes))
  Script.setOutput(path)
  await ShareSheet.present([path])
  try { fm.remove(path) } catch(e) {}
}

// ── Loading Overlay (WebView spinner) ──

function showLoading(title, subtitle) {
  let html = `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#f5f0e8;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;font-family:-apple-system,sans-serif;color:#1a1714}
.spinner{width:48px;height:48px;border:4px solid #e8e0d0;border-top-color:#7a4f2e;border-radius:50%;animation:spin .8s linear infinite;margin-bottom:24px}
@keyframes spin{to{transform:rotate(360deg)}}
h1{font-size:18px;font-weight:600;color:#7a4f2e;margin-bottom:8px}
p{font-size:14px;color:#8c8070;text-align:center;padding:0 32px}
</style></head><body>
<div class="spinner"></div>
<h1>${title}</h1>
<p>${subtitle}</p>
</body></html>`
  let wv = new WebView()
  wv.loadHTML(html)
  wv.present(false)
  return wv
}

async function hideLoading(wv) {
  try { await wv.evaluateJavaScript("document.title") } catch(e) {}
  try { await wv.dismiss() } catch(e) {}
}

// ── Alert Helper ──

async function showAlert(title, message) {
  let a = new Alert(); a.title = title; a.message = message; a.addAction("OK"); await a.present()
}

// ── Entry Point ──

async function run() {
  try {
    await mainFlow()
  } catch(e) {
    console.error("Fatal: " + e.message + "\n" + (e.stack || ""))
    let a = new Alert()
    a.title = "Error"
    a.message = e.message || "An unexpected error occurred"
    a.addAction("OK")
    await a.present()
  }
}

run()