/**
 * In-memory draft review comments for the Changes tab, keyed by chat id (or
 * the view's cwd when no chat is open). Drafts survive switching files, panes
 * and tabs within the session and are dropped when the app restarts.
 */
import { atom } from 'jotai'
import { atomFamily } from 'jotai/utils'
import type { ReviewComment } from './review-comments'

export const reviewCommentsAtomFamily = atomFamily((_key: string) => atom<ReviewComment[]>([]))
