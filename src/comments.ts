// SPDX-FileCopyrightText: 2026 Kaede Akino
// SPDX-License-Identifier: AGPL-3.0-or-later

import { eapi, web } from "./api.js";
import { PAGE } from "./constants.js";
import { toComment, trackIdentity } from "./models.js";
import type { ServiceComment } from "./service-types.js";
import { requireAccount } from "./session.js";
import type { CommentTarget, PageOptions } from "./types.js";
import { id, offsetOf, tr } from "./utils.js";

export async function comments({ trackId, offset = 0 }: CommentTarget & PageOptions) {
  const result = await web<{
    comments?: ServiceComment[];
    hotComments?: ServiceComment[];
    total?: number;
    more?: boolean;
  }>(`/api/v1/resource/comments/${trackIdentity(trackId).thread}`, {
    limit: PAGE,
    offset: offsetOf(offset),
  });
  // Only latest comments count toward the host's numeric pagination offset.
  // Hot comments have their own browse page so they cannot skip later comments.
  return {
    comments: (result.comments || []).map(toComment),
    total: result.total || 0,
    more: !!result.more,
  };
}

export async function likeComment({
  trackId,
  commentId,
  on,
}: CommentTarget & { commentId: string; on: boolean }) {
  requireAccount();
  await eapi(`/api/v1/comment/${on ? "like" : "unlike"}`, {
    threadId: trackIdentity(trackId).thread,
    commentId: id(commentId),
  });
}

export async function postComment({ trackId, text }: CommentTarget & { text: string }) {
  requireAccount();
  if (!text.trim()) throw new Error(tr("Comment cannot be empty"));
  const result = await eapi<{ comment?: ServiceComment }>("/api/resource/comments/add", {
    threadId: trackIdentity(trackId).thread,
    content: text.trim(),
  });
  if (!result.comment)
    throw new Error(
      tr("NetEase did not return the posted comment. Refresh to check before posting again."),
    );
  return toComment(result.comment);
}
