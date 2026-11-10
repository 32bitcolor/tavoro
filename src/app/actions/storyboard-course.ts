"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/dal";
import { createCourseFromStoryboard, storyboardCourseState } from "@/lib/storyboard-course";

// Storyboard → CourseForge course (docs/SUITE.md, step 3).

export async function storyboardCourseAction(storyboardId: string) {
  return (await storyboardCourseState(storyboardId)) ?? { app: null, course: null };
}

export async function createCourseFromStoryboardAction(storyboardId: string) {
  const me = await getCurrentUser();
  if (!me) return { error: "Not signed in." };
  const r = await createCourseFromStoryboard(storyboardId, me.id);
  if (!("error" in r)) {
    revalidatePath(`/storyboards/${storyboardId}`);
    if (r.card) revalidatePath("/boards", "layout");
  }
  return r;
}
