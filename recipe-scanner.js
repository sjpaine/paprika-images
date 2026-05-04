// Recipe Scanner for Paprika
// ============================
// Extract recipes from photos and create .paprikarecipe files
// for import into Paprika Recipe Manager on iOS.
//
// Setup:
// 1. Install Scriptable from the App Store
// 2. Add this script to Scriptable
// 3. Get a free API key at openrouter.ai
// 4. Run the script — it auto-detects your API key from clipboard
//    (copy on Mac, Universal Clipboard syncs to iPhone) or enter manually
// 5. Pick a recipe photo → enter cookbook/page → confirm → open in Paprika!

const CONFIG = {
  openRouterUrl: "https://openrouter.ai/api/v1/chat/completions",
  models: [
    "nvidia/nemotron-nano-12b-v2-vl:free",
    "google/gemma-3-12b-it:free",
    "google/gemma-3-4b-it:free",
    "google/gemma-3-27b-it:free",
    "google/gemma-4-26b-a4b-it:free"
  ],
  keychainKey: "openrouter_api_key",
  maxImageDimension: 1200
}

// ── Colors ──

const C = {
  accent: new Color("#E85D3A"),
  green: new Color("#34C759"),
  orange: new Color("#FF9500"),
  red: new Color("#FF3B30"),
  blue: new Color("#007AFF"),
  gray: new Color("#8E8E93"),
  lightGray: new Color("#E5E5EA"),
  darkText: new Color("#1C1C1E"),
  secondaryText: new Color("#636366"),
  bg: new Color("#F2F2F7"),
  white: Color.white()
}

// ── Main Menu ──

async function showMainMenu() {
  let hasKey = Keychain.contains(CONFIG.keychainKey)
  let table = new UITable()
  table.showSeparators = false

  let headerRow = new UITableRow()
  headerRow.height = 80
  headerRow.backgroundColor = C.accent
  let headerCell = headerRow.addText("Recipe Scanner", "Photo → Paprika in seconds")
  headerCell.titleFont = Font.boldSystemFont(22)
  headerCell.titleColor = C.white
  headerCell.subtitleColor = new Color("#FFCCC4")
  headerCell.subtitleFont = Font.systemFont(14)
  table.addRow(headerRow)

  let scanRow = new UITableRow()
  scanRow.height = 66
  scanRow.backgroundColor = C.white
  let scanCell = scanRow.addText("Scan Recipe", "Take a photo or pick from library")
  scanCell.titleFont = Font.boldSystemFont(17)
  scanCell.titleColor = C.accent
  scanCell.subtitleFont = Font.systemFont(13)
  scanCell.subtitleColor = C.secondaryText
  let scanIcon = scanRow.addImage(SFSymbol.named("camera.fill").image)
  scanIcon.widthWeight = 15
  scanRow.onSelect = async () => { await scanFlow() }
  table.addRow(scanRow)

  let keyRow = new UITableRow()
  keyRow.height = 50
  keyRow.backgroundColor = C.white
  let keyIcon = hasKey ? SFSymbol.named("checkmark.circle.fill").image : SFSymbol.named("key.fill").image
  let keyCell = keyRow.addText("API Key", hasKey ? "Configured — tap to change" : "Not set — tap to configure")
  keyCell.titleFont = Font.systemFont(15)
  keyCell.titleColor = C.darkText
  keyCell.subtitleFont = Font.systemFont(12)
  keyCell.subtitleColor = hasKey ? C.green : C.gray
  let keyImg = keyRow.addImage(keyIcon)
  keyImg.widthWeight = 15
  keyRow.onSelect = async () => { await configureApiKey() }
  table.addRow(keyRow)

  let infoRow = new UITableRow()
  infoRow.height = 50
  infoRow.backgroundColor = C.white
  let infoCell = infoRow.addText("About", "Uses free OpenRouter vision models")
  infoCell.titleFont = Font.systemFont(15)
  infoCell.titleColor = C.darkText
  infoCell.subtitleFont = Font.systemFont(12)
  infoCell.subtitleColor = C.secondaryText
  let infoImg = infoRow.addImage(SFSymbol.named("info.circle.fill").image)
  infoImg.widthWeight = 15
  infoRow.onSelect = async () => { await showAbout() }
  table.addRow(infoRow)

  await table.present()
}

// ── Scan Flow ──

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

  let responseText
  try {
    responseText = await callOpenRouter(apiKey, base64)
  } catch(apiErr) {
    await showAlert("API Error", apiErr.message)
    return
  }

  let recipe
  try {
    recipe = parseRecipe(responseText)
  } catch(parseErr) {
    await showAlert("Parse Error", parseErr.message)
    return
  }

  let confirmed = await showRecipePreview(recipe, sourceOverride, image)
  if (!confirmed) return

  let paprika = toPaprika(recipe, base64, sourceOverride)
  let paprikaJson = JSON.stringify(paprika, Object.keys(paprika).sort())
  let gzipped = gzip(paprikaJson)

  await saveAndShare(gzipped, paprika.name)

  let done = new Alert()
  done.title = "Done!"
  done.message = paprika.name + " has been shared.\nOpen it in Paprika to import."
  done.addAction("OK")
  await done.present()
}

// ── Recipe Preview ──

async function showRecipePreview(recipe, sourceOverride, image) {
  return new Promise(function(resolve) {
    let table = new UITable()
    table.showSeparators = true

    let finalSource = sourceOverride || recipe.source || ""

    // Header with image
    if (image) {
      let imgRow = new UITableRow()
      imgRow.height = 180
      imgRow.backgroundColor = C.white
      let imgCell = imgRow.addImage(image)
      imgCell.widthWeight = 100
      table.addRow(imgRow)
    }

    // Name and description
    let nameRow = new UITableRow()
    nameRow.height = 60
    nameRow.backgroundColor = C.white
    let desc = recipe.description || ""
    let nameCell = nameRow.addText(recipe.name || "Untitled Recipe", desc)
    nameCell.titleFont = Font.boldSystemFont(18)
    nameCell.titleColor = C.darkText
    nameCell.subtitleFont = Font.systemFont(13)
    nameCell.subtitleColor = C.secondaryText
    nameCell.widthWeight = 80
    table.addRow(nameRow)

    // Details section
    let times = []
    if (recipe.servings) times.push({ label: "Servings", value: recipe.servings })
    if (recipe.prep_time) times.push({ label: "Prep", value: recipe.prep_time })
    if (recipe.cook_time) times.push({ label: "Cook", value: recipe.cook_time })
    if (recipe.total_time) times.push({ label: "Total", value: recipe.total_time })
    if (finalSource) times.push({ label: "Source", value: finalSource })

    if (times.length > 0) {
      for (let t of times) {
        let row = new UITableRow()
        row.backgroundColor = C.white
        let labelCell = row.addText(t.label)
        labelCell.titleFont = Font.boldSystemFont(13)
        labelCell.titleColor = C.secondaryText
        labelCell.widthWeight = 30
        let valueCell = row.addText(t.value)
        valueCell.titleFont = Font.systemFont(13)
        valueCell.titleColor = C.darkText
        valueCell.widthWeight = 70
        table.addRow(row)
      }
    }

    // Ingredients
    let ingredients = (recipe.ingredients || "").replace(/\\n/g, "\n").split("\n").filter(function(l) { return l.trim() })
    if (ingredients.length > 0) {
      let headerRow = new UITableRow()
      headerRow.isHeader = true
      headerRow.addText("INGREDIENTS")
      table.addRow(headerRow)

      for (let ing of ingredients) {
        let row = new UITableRow()
        row.backgroundColor = C.white
        let dot = row.addImage(SFSymbol.named("circle.fill").image)
        dot.widthWeight = 8
        let cell = row.addText(ing.trim())
        cell.titleFont = Font.systemFont(14)
        cell.titleColor = C.darkText
        cell.widthWeight = 92
        table.addRow(row)
      }
    }

    // Directions
    let directions = (recipe.directions || "").replace(/\\n/g, "\n").split("\n").filter(function(l) { return l.trim() })
    if (directions.length > 0) {
      let dirHeader = new UITableRow()
      dirHeader.isHeader = true
      dirHeader.addText("DIRECTIONS")
      table.addRow(dirHeader)

      for (let i = 0; i < directions.length; i++) {
        let row = new UITableRow()
        row.backgroundColor = C.white
        let numCell = row.addText(String(i + 1))
        numCell.titleFont = Font.boldSystemFont(14)
        numCell.titleColor = C.accent
        numCell.widthWeight = 10
        let stepCell = row.addText(directions[i].trim())
        stepCell.titleFont = Font.systemFont(14)
        stepCell.titleColor = C.darkText
        stepCell.widthWeight = 90
        table.addRow(row)
      }
    }

    // Notes
    let notes = (recipe.notes || "").replace(/\\n/g, "\n").trim()
    if (notes) {
      let notesHeader = new UITableRow()
      notesHeader.isHeader = true
      notesHeader.addText("NOTES")
      table.addRow(notesHeader)

      let notesRow = new UITableRow()
      notesRow.backgroundColor = C.white
      let notesCell = notesRow.addText(notes)
      notesCell.titleFont = Font.systemFont(13)
      notesCell.titleColor = C.secondaryText
      notesCell.widthWeight = 100
      table.addRow(notesRow)
    }

    // Buttons
    let createRow = new UITableRow()
    createRow.height = 54
    createRow.backgroundColor = C.accent
    let createCell = createRow.addText("Create Paprika File")
    createCell.titleFont = Font.boldSystemFont(18)
    createCell.titleColor = C.white
    createCell.widthWeight = 100
    createRow.onSelect = function() { resolve(true) }
    createRow.dismissOnSelect = true
    table.addRow(createRow)

    let cancelRow = new UITableRow()
    cancelRow.height = 44
    cancelRow.backgroundColor = C.white
    let cancelCell = cancelRow.addText("Cancel")
    cancelCell.titleFont = Font.systemFont(16)
    cancelCell.titleColor = C.red
    cancelCell.widthWeight = 100
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
  alert.title = "OpenRouter API Key"
  alert.message = currentKey ? "Current key: " + currentKey.substring(0, 14) + "...\n\nEnter a new key to replace it, or clear to remove." : "Enter your OpenRouter API key.\n\nGet one free at openrouter.ai"
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
      await showAlert("Invalid Key", "Key should start with 'sk-'. Please check and try again.")
    }
  } else if (choice === 1) {
    if (Keychain.contains(CONFIG.keychainKey)) {
      Keychain.remove(CONFIG.keychainKey)
      await showAlert("Cleared", "API key removed from Keychain.")
    }
  }
}

// ── API Key Setup (first-time) ──

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
  alert.title = "OpenRouter API Key"
  alert.message = "Enter your OpenRouter API key.\n\nGet one free at openrouter.ai\n\nTip: Copy the key on your Mac — it will auto-detect from clipboard."
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
    if (!img) {
      await showAlert("No Image", "No image was selected.")
      return null
    }
    return img
  } catch(e) {
    await showAlert("Image Error", "Could not select image: " + e.message)
    return null
  }
}

function imageToBase64(image) {
  let maxDim = CONFIG.maxImageDimension
  let w = image.size.width
  let h = image.size.height
  let scale = Math.min(1, maxDim / Math.max(w, h))
  let newW = Math.round(w * scale)
  let newH = Math.round(h * scale)

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
  alert.message = "Optional: enter the cookbook name and page number.\nThis will be saved as the recipe source in Paprika."
  alert.addTextField("Cookbook name")
  alert.addTextField("Page number")
  alert.addAction("Continue")
  alert.addCancelAction("Skip")
  let choice = await alert.present()
  if (choice === -1) return null
  let cookbook = alert.textFieldValue(0).trim()
  let page = alert.textFieldValue(1).trim()
  if (!cookbook && !page) return null
  if (cookbook && page) return cookbook + " - p. " + page
  if (cookbook) return cookbook
  return "p. " + page
}

// ── About ──

async function showAbout() {
  let table = new UITable()
  table.showSeparators = true

  let headerRow = new UITableRow()
  headerRow.height = 70
  headerRow.backgroundColor = C.accent
  let hCell = headerRow.addText("Recipe Scanner", "Photo → Paprika in seconds")
  hCell.titleFont = Font.boldSystemFont(20)
  hCell.titleColor = C.white
  hCell.subtitleColor = new Color("#FFCCC4")
  hCell.subtitleFont = Font.systemFont(13)
  table.addRow(headerRow)

  let aboutItems = [
    { label: "How it works", value: "Take a photo of a recipe, and this script uses AI vision models (via OpenRouter) to extract the recipe text. It then generates a .paprikarecipe file you can open directly in Paprika." },
    { label: "Models", value: "Tries free models in order: nvidia/nemotron-nano-12b-v2-vl:free, google/gemma-3-12b-it:free, and more. Automatically falls back on rate limits." },
    { label: "Privacy", value: "Your API key is stored in iOS Keychain. Photos are sent to OpenRouter for processing. No data is stored on any server." },
    { label: "Format", value: "Generates .paprikarecipe files (gzipped JSON) matching Paprika 3's native import format with SHA-256 hashes." }
  ]

  for (let item of aboutItems) {
    let row = new UITableRow()
    row.backgroundColor = C.white
    let cell = row.addText(item.label, item.value)
    cell.titleFont = Font.boldSystemFont(14)
    cell.titleColor = C.darkText
    cell.subtitleFont = Font.systemFont(12)
    cell.subtitleColor = C.secondaryText
    cell.widthWeight = 100
    table.addRow(row)
  }

  await table.present()
}

// ── OpenRouter Vision API ──

const EXTRACT_PROMPT = `You are a recipe extraction assistant. Extract the recipe from this photo and return ONLY a JSON object with these exact fields:

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

function sleep(ms) {
  return new Promise(function(resolve) { setTimeout(resolve, ms) })
}

async function callOpenRouter(apiKey, base64Image) {
  let lastError = null

  for (let i = 0; i < CONFIG.models.length; i++) {
    let model = CONFIG.models[i]
    log("Trying model " + (i + 1) + "/" + CONFIG.models.length + ": " + model)

    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) {
        log("Retry " + attempt + " after 10s wait...")
        await sleep(10000)
      }

      let req = new Request(CONFIG.openRouterUrl)
      req.method = "POST"
      req.headers = {
        "Authorization": "Bearer " + apiKey,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://scriptable.app",
        "X-OpenRouter-Title": "Paprika Recipe Scanner"
      }
      req.timeoutInterval = 120

      let body = JSON.stringify({
        model: model,
        messages: [{
          role: "user",
          content: [
            { type: "text", text: EXTRACT_PROMPT },
            { type: "image_url", image_url: { url: "data:image/jpeg;base64," + base64Image } }
          ]
        }]
      })
      req.body = body

      let response
      try {
        response = await req.loadJSON()
      } catch(e) {
        log("Request failed: " + e.message)
        lastError = new Error("Network error: " + e.message)
        continue
      }

      let status = req.response.statusCode

      if (status === 429) {
        log("Rate limited on " + model)
        if (attempt === 0) continue
        lastError = new Error("Rate limited on " + model + ". Trying next model...")
        break
      }

      if (status !== 200) {
        let msg = "Unknown error"
        if (response.error) msg = response.error.message || JSON.stringify(response.error)
        else msg = JSON.stringify(response).substring(0, 200)
        log("Error from " + model + ": " + msg)
        lastError = new Error("API error (" + status + "): " + msg)
        if (status >= 400 && status < 500 && status !== 429) break
        continue
      }

      if (!response.choices || !response.choices[0] || !response.choices[0].message || !response.choices[0].message.content) {
        log("Empty response from " + model)
        lastError = new Error("Empty response from " + model)
        break
      }

      log("Success with " + model)
      return response.choices[0].message.content
    }
  }

  throw lastError || new Error("All models failed. Please try again later.")
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

var sha256K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
  0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
  0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
  0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
  0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
  0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
]

function sha256Hex(str) {
  if (typeof str === "string") {
    var encoded = []
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i)
      if (c < 0x80) encoded.push(c)
      else if (c < 0x800) { encoded.push(0xC0|(c>>6)); encoded.push(0x80|(c&0x3F)) }
      else if (c >= 0xD800 && c <= 0xDBFF) {
        var hi = c, lo = str.charCodeAt(++i)
        var cp = ((hi - 0xD800) << 10) + (lo - 0xDC00) + 0x10000
        encoded.push(0xF0|(cp>>18)); encoded.push(0x80|((cp>>12)&0x3F))
        encoded.push(0x80|((cp>>6)&0x3F)); encoded.push(0x80|(cp&0x3F))
      } else { encoded.push(0xE0|(c>>12)); encoded.push(0x80|((c>>6)&0x3F)); encoded.push(0x80|(c&0x3F)) }
    }
    str = encoded
  }
  var h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a
  var h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19
  var msgLen = str.length, bitLen = msgLen * 8
  str.push(0x80)
  while (str.length % 64 !== 56) str.push(0)
  str.push(0, 0, 0, 0)
  str.push((bitLen >>> 24) & 0xFF, (bitLen >>> 16) & 0xFF, (bitLen >>> 8) & 0xFF, bitLen & 0xFF)
  for (var offset = 0; offset < str.length; offset += 64) {
    var w = new Array(64)
    for (var i = 0; i < 16; i++) { var j = offset + i * 4; w[i] = (str[j] << 24) | (str[j+1] << 16) | (str[j+2] << 8) | str[j+3] }
    for (var i = 16; i < 64; i++) {
      var s0 = ((w[i-15] >>> 7) | (w[i-15] << 25)) ^ ((w[i-15] >>> 18) | (w[i-15] << 14)) ^ (w[i-15] >>> 3)
      var s1 = ((w[i-2] >>> 17) | (w[i-2] << 15)) ^ ((w[i-2] >>> 19) | (w[i-2] << 13)) ^ (w[i-2] >>> 10)
      w[i] = (w[i-16] + s0 + w[i-7] + s1) | 0
    }
    var a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, hh = h7
    for (var i = 0; i < 64; i++) {
      var S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7))
      var ch = (e & f) ^ ((~e) & g); var temp1 = (hh + S1 + ch + sha256K[i] + w[i]) | 0
      var S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10))
      var maj = (a & b) ^ (a & c) ^ (b & c); var temp2 = (S0 + maj) | 0
      hh = g; g = f; f = e; e = (d + temp1) | 0; d = c; c = b; b = a; a = (temp1 + temp2) | 0
    }
    h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0
    h4 = (h4 + e) | 0; h5 = (h5 + f) | 0; h6 = (h6 + g) | 0; h7 = (h7 + hh) | 0
  }
  function hex(n) { var s = ""; for (var i = 7; i >= 0; i--) { s += ((n >>> (i*4)) & 0xF).toString(16); } return s; }
  return hex(h0) + hex(h1) + hex(h2) + hex(h3) + hex(h4) + hex(h5) + hex(h6) + hex(h7)
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
  let y = d.getFullYear(), mo = String(d.getMonth() + 1).padStart(2, "0")
  let da = String(d.getDate()).padStart(2, "0"), h = String(d.getHours()).padStart(2, "0")
  let mi = String(d.getMinutes()).padStart(2, "0"), s = String(d.getSeconds()).padStart(2, "0")
  return y + "-" + mo + "-" + da + " " + h + ":" + mi + ":" + s
}

// ── Gzip Compression (stored blocks, RFC 1952) ──

function crc32(data) {
  let table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) { let c = i; for (let j = 0; j < 8; j++) { c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1) } table[i] = c }
  let crc = 0xFFFFFFFF
  for (let i = 0; i < data.length; i++) crc = table[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8)
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
  await ShareSheet.present([path])
  try { fm.remove(path) } catch(e) {}
}

// ── Alert Helper ──

async function showAlert(title, message) {
  let a = new Alert()
  a.title = title
  a.message = message
  a.addAction("OK")
  await a.present()
}

// ── Entry Point ──

showMainMenu()