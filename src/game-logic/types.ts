export type RoleName = 'duke' | 'captain' | 'ambassador' | 'princess' | 'assassin' | 'contessa'

export type ActionType =
  | 'income'           // بدون ادعا، بدون چالش
  | 'foreign_aid'      // بدون ادعا، قابل بلاک با duke
  | 'coup'             // بدون ادعا، بدون بلاک/چالش
  | 'tax'              // ادعای duke
  | 'assassinate'      // ادعای assassin
  | 'steal'            // ادعای captain
  | 'exchange'         // ادعای ambassador
  | 'contessa_self'    // ادعای contessa (روی خود شخص)
  | 'contessa_other'   // ادعای contessa (روی یه بازیکن دیگه)
  | 'anarchist_attack' // بدون ادعای نقش؛ فقط پرداخت ۵ سکه

export interface Player {
  id: string
  name: string
  connectionId?: string
  coins: number
  roles: RoleName[]     // ۱ یا ۲ کارت
  revealed: boolean[]   // هم‌طول roles؛ true یعنی این کارت رو کرده (دیگه زنده نیست)
  isAlive: boolean
}

// ---- وضعیت یه اکشن معمولی که منتظر پاسخ (allow/challenge/block) هست ----
export interface PendingAction {
  id: string
  actorId: string
  action: ActionType
  targetId?: string           // برای assassinate/steal/coup/contessa_other/anarchist_attack
  claimedRole?: RoleName      // نقشی که actor ادعا کرده (اگه اکشن نیاز به ادعا داشته باشه)
  awaitingResponseFrom: string[]
  responses: Record<string, 'allow' | 'challenge'>
  // اگه یکی block کرد (فقط برای foreign_aid/assassinate/steal)
  blockedBy?: { playerId: string; claimedRole: RoleName }
  blockChallengeResponses?: Record<string, 'allow' | 'challenge'>
  createdAt: number

  claimedCardIndex?: number  // فقط برای contessa_self، خصوصیه
  selfSwapDone?: boolean     // تعویض حین اثبات انجام شده
}

// ---- زنجیره‌ی حمله‌ی آنارشیست (مکانیزم مخصوص این بازی) ----
export interface AnarchistAttack {
  id: string
  originalAttackerId: string   // مهاجم اول، همیشه ثابت، هزینه رو این نفر پرداخته
  currentTargetId: string      // کارت الان دست کیه
  previousHolders: string[]    // همه‌ی کسایی که قبلاً کارت رو داشتن (برای exclude کردن از pass بعدی)
  status:
  | 'awaiting_block_response'      // منتظریم currentTarget تصمیم بگیره: بلاک کنه (ادعای شاهدخت) یا نه
  | 'awaiting_challenge_on_block'  // یکی ادعای شاهدخت کرد، منتظر challenge از بقیه
  | 'awaiting_pass_target'         // بلاک موفق شد، منتظریم مدافع هدف بعدی رو انتخاب کنه
  claimedBlockRole?: RoleName        // همیشه 'princess' وقتی بلاک می‌شه
  blockChallengeResponses?: Record<string, 'allow' | 'challenge'>
  createdAt: number
}

export type GamePhase =
  | 'waiting_for_players'
  | 'awaiting_action'
  | 'awaiting_response'
  | 'awaiting_block_response'
  | 'proving_claim'
  | 'anarchist_in_progress'
  | 'exchange_in_progress'   // برای ambassador (انتخاب ۲ کارت از ۴)
  | 'contessa_in_progress'   // برای contessa_other (هدف باید یه کارت انتخاب کنه)
  | 'game_over'
  | 'restart_vote'
  | 'room_closed'

export interface PublicGameState {
  roomId: string
  phase: GamePhase
  players: Array<Omit<Player, 'roles'> & { roleCount: number }>
  turnOrder: string[]
  currentTurnIndex: number
  pendingAction: PendingAction | null
  anarchistAttack: AnarchistAttack | null
  deckCount: number
  log: string[]
  winnerId?: string
}

export interface PrivateGameState {
  yourRoles: RoleName[]
  yourRevealed: boolean[]
}

// ---- پیام‌های کلاینت -> سرور ----
export type ClientMessage =
  | { type: 'start_game' }
  | { type: 'action'; action: ActionType; targetId?: string }
  | { type: 'respond'; response: 'allow' | 'challenge' }
  | { type: 'block'; claimedRole: RoleName }               // برای foreign_aid/assassinate/steal
  | { type: 'respond_to_block'; response: 'allow' | 'challenge' }
  | { type: 'exchange_select'; keepRoleIndexes: number[] } // برای ambassador
  | { type: 'contessa_self_select'; swapRoleIndex: number } // بازرس روی خودش
  | { type: 'contessa_other_select'; swapRoleIndex: number } // هدف، کارتشو انتخاب می‌کنه
  | { type: 'anarchist_block' }                             // ادعای شاهدخت
  | { type: 'anarchist_pass'; targetId: string }            // مدافع، هدف بعدی رو انتخاب می‌کنه
  | { type: 'reveal_card'; roleIndex: number }               // وقتی باید یه کارت رو کور کنه (باخت چالش یا ترور)
  | { type: 'chat'; text: string }

// ---- پیام‌های سرور -> کلاینت ----
export type ServerMessage =
  | { type: 'state'; state: PublicGameState }
  | { type: 'private'; private: PrivateGameState }
  | { type: 'players'; players: any[] } // برای سازگاری با چیزی که الان داریم
  | { type: 'log'; log: string[] }
  | { type: 'error'; message: string }