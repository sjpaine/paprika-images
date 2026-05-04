# Recipe Scanner for Paprika

A Scriptable (iOS) script that scans recipe photos and creates `.paprikarecipe` files you can open directly in Paprika Recipe Manager.

## How It Works

```
Photo → Recipe source input → OpenRouter Vision API (free) → Structured recipe JSON
     → SHA-256 hashes → Paprika format JSON → Gzip → .paprikarecipe → Paprika
```

1. Pick or photograph a recipe
2. Optionally enter cookbook name & page number (becomes the recipe source)
3. The image is sent to a free vision LLM via OpenRouter
4. The LLM extracts structured recipe data
5. Confirm the extracted recipe
6. The data is converted to Paprika format with proper hashes, gzipped, and shared via iOS share sheet
7. Open in Paprika — done

## Setup

### 1. Install Scriptable

Download [Scriptable](https://apps.apple.com/us/app/scriptable/id1405459188) from the App Store.

### 2. Get an OpenRouter API key (free)

1. Go to [openrouter.ai](https://openrouter.ai)
2. Sign up and create an API key (starts with `sk-or-v1-`)
3. Free tier includes access to vision models

### 3. Add the script

Copy `recipe-scanner.js` into Scriptable:
- Open Scriptable → tap **+** → paste the script contents
- Or use iCloud Drive: `iCloud Drive/Scriptable/recipe-scanner.js`

### 4. Run it

1. Open Scriptable and tap **Recipe Scanner**
2. First run: enter your API key (or copy it on your Mac — it auto-detects from Universal Clipboard)
3. Pick a recipe photo from your library or camera
4. Optionally enter cookbook name and page number (or skip)
5. Confirm the extracted recipe
6. Share the `.paprikarecipe` file → **Open in Paprika**

Your API key is stored securely in iOS Keychain after the first run.

## API Key Transfer (Mac → iPhone)

The easiest way to get your API key onto your iPhone:

1. Copy `sk-or-v1-...` on your Mac
2. Run the script on your iPhone
3. It detects the key from Universal Clipboard automatically
4. Tap **Use This Key** — stored in Keychain, never asked again

## Models

The script automatically tries free OpenRouter vision models in order, with retry on rate limits:

1. `nvidia/nemotron-nano-12b-v2-vl:free` (default — works reliably, good OCR)
2. `google/gemma-3-12b-it:free` (fallback)
3. `google/gemma-3-4b-it:free` (fallback)
4. `google/gemma-3-27b-it:free` (best quality, often rate-limited)
5. `google/gemma-4-26b-a4b-it:free` (newer, often rate-limited)

On a 429 (rate limit) error, it retries once after 10 seconds, then moves to the next model.

## Image Handling

Photos from iPhone cameras can be very large (HEIC, 12MB+). The script automatically:
- Resizes images to max 1200px on the longest side
- Converts to JPEG at 80% quality
- Result: ~300-500KB base64 payload (fits within free tier limits)

Adjust `CONFIG.maxImageDimension` in the script if you need higher resolution.

## Paprika Format

The script generates `.paprikarecipe` files matching Paprika 3's native format (gzipped JSON). All fields from the reference library are included:

| Field | Description |
|-------|-------------|
| `uid` | Auto-generated UUID (uppercase) |
| `name` | Recipe title |
| `description` | Short description from LLM |
| `ingredients` | One ingredient per line |
| `directions` | One step per line |
| `servings` | Yield/servings |
| `prep_time` | Preparation time |
| `cook_time` | Cooking time |
| `total_time` | Total time |
| `notes` | Additional notes/tips |
| `nutritional_info` | Nutritional info |
| `categories` | Category tags (array) |
| `rating` | Default 0 |
| `difficulty` | Empty string |
| `source` | Cookbook name & page (from user input or LLM) |
| `source_url` | URL if visible |
| `created` | Timestamp |
| `hash` | SHA-256 of all fields (excluding hash), sorted keys |
| `photo_hash` | SHA-256 of photo base64 data |
| `photo` | Same as photo_hash |
| `photo_data` | Photo as base64 JPEG |
| `photo_large` | null |
| `image_url` | Empty string |

## Recipe Source Input

After selecting a photo, you'll see an optional dialog:

- **Cookbook name** — e.g. "Basisdeeg"
- **Page number** — e.g. "121"

These are combined into the `source` field as `"Basisdeeg - p. 121"`. If you skip, the LLM-extracted source (if any) is used instead.

## Troubleshooting

- **"Empty response from model"** — The free model may be rate-limited. The script will automatically try the next model. If all fail, wait a few minutes.
- **"No JSON found in model response"** — The model returned unexpected output. Try a clearer photo or switch models.
- **Paprika doesn't appear in share sheet** — Make sure Paprika is installed. iOS only shows relevant apps for `.paprikarecipe` files.
- **Camera not available** — Camera access requires permission. Check Settings → Scriptable → Camera.
- **Rate limit (429) errors** — Free models have usage limits. The script retries once and falls back to other models.