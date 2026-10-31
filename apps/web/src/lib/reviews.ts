"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { Review, type ReviewInput } from "@hp/contracts";
import { ApiClientError } from "@hp/api-client";
import { browserApi } from "./api";

export const REVIEWS_PAGE_SIZE = 5;

const reviewsKey = (slug: string) => ["reviews", slug] as const;
const reviewsPath = (slug: string) => `/products/${encodeURIComponent(slug)}/reviews`;

export function useReviews(slug: string, page: number) {
  return useQuery({
    queryKey: [...reviewsKey(slug), page],
    queryFn: () =>
      browserApi.get(
        `${reviewsPath(slug)}?page=${page}&pageSize=${REVIEWS_PAGE_SIZE}`,
        z.array(Review),
      ),
    placeholderData: (previous) => previous,
  });
}

export function useSubmitReview(slug: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: ReviewInput) =>
      (await browserApi.post(reviewsPath(slug), input, Review)).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: reviewsKey(slug) }),
  });
}

export type ReviewError = { kind: "signin" | "message"; message: string };

const FALLBACK = "We couldn't post your review. Please try again.";

/** 401 asks the shopper to sign in; 403 and 409 show the API's own explanation. */
export function reviewErrorFor(error: unknown): ReviewError {
  if (!(error instanceof ApiClientError)) return { kind: "message", message: FALLBACK };
  if (error.status === 401) return { kind: "signin", message: "Sign in to write a review." };
  return { kind: "message", message: error.message || FALLBACK };
}
