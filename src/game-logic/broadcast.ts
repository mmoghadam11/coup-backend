import { GameState, isEliminated } from './state'

export function buildPublicPayload(game: GameState) {
  return {
    type: 'state',
    state: {
      phase: game.phase,
      roomName: game.roomName,
      origin: game.origin,                           // این خط اضافه شد
      roomPhase: game.roomPhase,                      // این خط اضافه شد
      countdownEndsAt: game.countdownEndsAt,          // این خط اضافه شد
      handResultEndsAt: game.handResultEndsAt,
      creatorId: game.creatorId ? String(game.creatorId) : null,
      players: game.players.map((p) => ({
        id: String(p.userId),
        name: p.firstName,
        photoUrl: p.photoUrl,
        connected: p.connected,
        coins: p.coins,
        roleCount: p.roles.length - p.revealed.filter((r) => r).length,
        revealedRoles: p.roles.filter((_, i) => p.revealed[i]),
        isAlive: !isEliminated(p),
        stats: p.stats,
      })),
      turnOrder: game.turnOrder.map(String),
      currentTurnIndex: game.currentTurnIndex,
      deckCount: game.deck.length,
      log: game.log.slice(-100),
      // pendingAction: game.pendingAction,
      pendingAction: game.pendingAction
        ? (({ claimedCardIndex, selfSwapDone, ...publicPart }) => publicPart)(game.pendingAction)
        : null,
      revealPending: game.revealPending
        ? { playerId: String(game.revealPending.playerId), reason: game.revealPending.reason, actorId: game.revealPending.actorId ? String(game.revealPending.actorId) : null, }
        : null,
      provePending: game.provePending
        ? { playerId: String(game.provePending.playerId), claimedRole: game.provePending.claimedRole }
        : null,
      selectionPending: game.selectionPending
        ? { playerId: String(game.selectionPending.playerId), mode: game.selectionPending.mode }
        : null,
      anarchistPending: game.anarchistPending
        ? {
          originalAttackerId: String(game.anarchistPending.originalAttackerId),
          currentTargetId: String(game.anarchistPending.currentTargetId),
          chain: game.anarchistPending.chain.map(String),
          status: game.anarchistPending.status,
          blockChallengeResponses: game.anarchistPending.blockChallengeResponses || {}, // این خط اضافه شد
        }
        : null,
      restartVote: game.restartVote
        ? {
          reopenForJoining: game.restartVote.reopenForJoining,
          responses: game.restartVote.responses,
          waitingFor: game.players
            .filter((p) => p.userId !== game.creatorId && !game.restartVote!.responses[String(p.userId)])
            .map((p) => String(p.userId)),
        }
        : null,
      winnerId: game.winnerId ? String(game.winnerId) : null,
      showcase: game.showcase
        ? {
          kind: game.showcase.kind,
          playerId: String(game.showcase.playerId),
          role: game.showcase.role ?? null,          // برای replacement همیشه null؛ کارت جدید لو نمی‌ره
          success: game.showcase.success ?? null,
          eliminated: game.showcase.eliminated ?? null,
          endsAt: game.showcase.endsAt,
          shuffle: game.showcase.shuffle ?? false,
        }
        : null,
    },
  }
}