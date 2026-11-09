"use server";

import { revalidatePath } from "next/cache";
import { getCardForUser } from "@/lib/authz";
import { getCurrentUser } from "@/lib/dal";
import * as cc from "@/lib/card-courses";

// The card drawer's "Course" section (docs/SUITE.md, step 2).

async function done<T>(cardId: string, r: T) {
  const card = await getCardForUser(cardId);
  if (card) revalidatePath(`/boards/${card.boardId}`);
  return r;
}

export async function getCardCourseAction(cardId: string, refresh = false) {
  return cc.getCardCourse(cardId, refresh);
}

export async function findCoursesAction(cardId: string, q: string) {
  const me = await getCurrentUser();
  if (!me) return { error: "Not signed in." };
  return cc.findCourses(cardId, me.id, q);
}

export async function linkCourseAction(cardId: string, courseId: string) {
  const me = await getCurrentUser();
  if (!me) return { error: "Not signed in." };
  return done(cardId, await cc.linkCourse(cardId, me.id, courseId));
}

export async function createCourseForCardAction(cardId: string) {
  const me = await getCurrentUser();
  if (!me) return { error: "Not signed in." };
  return done(cardId, await cc.createCourseForCard(cardId, me.id));
}

export async function unlinkCourseAction(cardId: string) {
  const me = await getCurrentUser();
  if (!me) return { error: "Not signed in." };
  return done(cardId, await cc.unlinkCourse(cardId, me.id));
}
