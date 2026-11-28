// واحد پولی ویژه؛ جدا از سکه‌ی داخل بازی. فقط اینجا عوض می‌شود
export const PREMIUM_CURRENCY = { name: 'نگین', glyph: '💎' }

export const MAX_EQUIPPED_REACTIONS = 6
export const DEFAULT_EQUIPPED_IDS = ['wow', 'cry', 'laugh', 'clap', 'smirk', 'horns']

export const CATEGORY_LABELS: Record<string, string> = {
  surprise: 'تعجب', sad: 'گریه', happy: 'شادی', tease: 'تیکه', other: 'سایر',
}

export interface ReactionDef {
  id: string
  glyph: string
  label: string
  category: string
  comments: string[]
  price: number       // به واحد PREMIUM_CURRENCY؛ ۰ = رایگان
  mature: boolean
  active: boolean
  sort: number
}

export const pickRandomComment = (reaction: { comments: string[] }) =>
  reaction.comments[Math.floor(Math.random() * reaction.comments.length)]

// اعتبارسنجی ورودی ادمین؛ خطا را به‌صورت متن فارسی برمی‌گرداند
export function validateReactionInput(
  requestBody: any,
  isCreating: boolean,
): { errorMessage?: string; cleaned?: Partial<ReactionDef> } {
  const cleaned: Partial<ReactionDef> = {}

  if (isCreating) {
    if (typeof requestBody.id !== 'string' || !/^[a-z0-9_]{2,24}$/.test(requestBody.id)) {
      return { errorMessage: 'شناسه فقط حروف انگلیسی کوچک، عدد و _ (۲ تا ۲۴ نویسه)' }
    }
    cleaned.id = requestBody.id
  }

  if (isCreating || 'glyph' in requestBody) {
    const glyphText = typeof requestBody.glyph === 'string' ? requestBody.glyph.trim() : ''
    if (!glyphText || Array.from(glyphText).length > 8) return { errorMessage: 'ایموجی خالی یا خیلی بلند است' }
    cleaned.glyph = glyphText
  }

  if (isCreating || 'label' in requestBody) {
    const labelText = typeof requestBody.label === 'string' ? requestBody.label.trim() : ''
    if (!labelText || labelText.length > 24) return { errorMessage: 'عنوان ۱ تا ۲۴ نویسه' }
    cleaned.label = labelText
  }

  if ('category' in requestBody) {
    if (!(requestBody.category in CATEGORY_LABELS)) return { errorMessage: 'دسته نامعتبر است' }
    cleaned.category = requestBody.category
  }

  if (isCreating || 'comments' in requestBody) {
    const commentList: string[] = Array.isArray(requestBody.comments)
      ? requestBody.comments.map((commentItem: unknown) => String(commentItem).trim()).filter(Boolean)
      : []
    const hasTooLongComment = commentList.some((commentItem) => commentItem.length > 60)
    if (commentList.length < 1 || commentList.length > 12 || hasTooLongComment) {
      return { errorMessage: '۱ تا ۱۲ جمله، هر کدام تا ۶۰ نویسه' }
    }
    cleaned.comments = commentList
  }

  if ('price' in requestBody) {
    const priceNumber = Number(requestBody.price)
    if (!Number.isInteger(priceNumber) || priceNumber < 0 || priceNumber > 1_000_000) {
      return { errorMessage: 'قیمت باید عدد صحیح ۰ یا بیشتر باشد' }
    }
    cleaned.price = priceNumber
  }

  if ('mature' in requestBody) cleaned.mature = !!requestBody.mature
  if ('active' in requestBody) cleaned.active = !!requestBody.active

  if ('sort' in requestBody) {
    const sortNumber = Number(requestBody.sort)
    if (!Number.isInteger(sortNumber) || Math.abs(sortNumber) > 9999) return { errorMessage: 'ترتیب نامعتبر است' }
    cleaned.sort = sortNumber
  }

  return { cleaned }
}