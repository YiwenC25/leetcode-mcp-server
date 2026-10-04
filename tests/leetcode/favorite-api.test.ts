import { describe, expect, it, vi } from "vitest";
import {
    addQuestionsToFavorite,
    createFavorite,
    fetchFavoriteDetail,
    fetchFavoriteQuestions,
    fetchMyFavoriteLists,
    removeQuestionsFromFavorite,
    unwrapGraphQL,
    updateFavoriteIsPublic,
    updateFavoriteNameDescription
} from "../../src/leetcode/favorite-api.js";

/**
 * Builds a GraphQL executor mock that resolves with the given responses in order.
 */
function graphqlMock(...responses: unknown[]) {
    const executor = vi.fn();
    for (const response of responses) {
        executor.mockResolvedValueOnce(response);
    }
    return executor;
}

describe("favorite-api", () => {
    describe("unwrapGraphQL", () => {
        it("returns data when there are no errors", () => {
            expect(unwrapGraphQL({ data: { foo: 1 } }, "op")).toStrictEqual({
                foo: 1
            });
        });

        it("returns an empty object when data is missing", () => {
            expect(unwrapGraphQL({}, "op")).toStrictEqual({});
            expect(unwrapGraphQL(undefined, "op")).toStrictEqual({});
        });

        it("throws with every GraphQL error message", () => {
            expect(() =>
                unwrapGraphQL(
                    {
                        errors: [{ message: "first" }, { message: "second" }],
                        data: null
                    },
                    "favoriteDetailV2"
                )
            ).toThrow("favoriteDetailV2: first; second");
        });
    });

    describe("fetchMyFavoriteLists", () => {
        it("queries only created lists by default", async () => {
            const graphql = graphqlMock({
                data: {
                    myCreatedFavoriteList: {
                        hasMore: false,
                        totalLength: 1,
                        favorites: [{ slug: "abc", name: "Mine" }]
                    }
                }
            });

            const result = await fetchMyFavoriteLists(graphql);

            expect(graphql).toHaveBeenCalledTimes(1);
            expect(graphql.mock.calls[0][0].query).toContain(
                "myCreatedFavoriteList"
            );
            expect(result).toStrictEqual({
                created: {
                    hasMore: false,
                    totalLength: 1,
                    favorites: [{ slug: "abc", name: "Mine" }]
                }
            });
        });

        it("also queries collected lists when requested", async () => {
            const graphql = graphqlMock(
                { data: { myCreatedFavoriteList: null } },
                {
                    data: {
                        myCollectedFavoriteList: {
                            hasMore: true,
                            totalLength: 7,
                            favorites: [{ slug: "saved" }]
                        }
                    }
                }
            );

            const result = await fetchMyFavoriteLists(graphql, {
                includeCollected: true
            });

            expect(graphql).toHaveBeenCalledTimes(2);
            expect(graphql.mock.calls[1][0].query).toContain(
                "myCollectedFavoriteList"
            );
            expect(result.created).toStrictEqual({
                hasMore: false,
                totalLength: 0,
                favorites: []
            });
            expect(result.collected).toStrictEqual({
                hasMore: true,
                totalLength: 7,
                favorites: [{ slug: "saved" }]
            });
        });
    });

    describe("fetchFavoriteDetail", () => {
        it("passes the slug and returns the detail node", async () => {
            const detail = { slug: "abc", name: "Mine", description: "d" };
            const graphql = graphqlMock({ data: { favoriteDetailV2: detail } });

            await expect(fetchFavoriteDetail(graphql, "abc")).resolves.toBe(
                detail
            );
            expect(graphql.mock.calls[0][0].variables).toStrictEqual({
                favoriteSlug: "abc"
            });
        });

        it("throws when the list does not exist", async () => {
            const graphql = graphqlMock({ data: { favoriteDetailV2: null } });

            await expect(
                fetchFavoriteDetail(graphql, "missing")
            ).rejects.toThrow("Problem list missing not found");
        });
    });

    describe("fetchFavoriteQuestions", () => {
        it("applies default pagination and simplifies questions", async () => {
            const graphql = graphqlMock({
                data: {
                    favoriteQuestionList: {
                        hasMore: true,
                        totalLength: 120,
                        questions: [
                            {
                                id: "1",
                                questionFrontendId: "1",
                                title: "Two Sum",
                                translatedTitle: "两数之和",
                                titleSlug: "two-sum",
                                difficulty: "EASY",
                                status: "SOLVED",
                                paidOnly: false,
                                topicTags: [
                                    { name: "Array", slug: "array" },
                                    { name: "Hash Table", slug: "hash-table" }
                                ]
                            }
                        ]
                    }
                }
            });

            const result = await fetchFavoriteQuestions(graphql, "abc");

            expect(graphql.mock.calls[0][0].variables).toStrictEqual({
                favoriteSlug: "abc",
                limit: 50,
                skip: 0,
                searchKeyword: undefined,
                sortBy: { sortField: "CUSTOM", sortOrder: "ASCENDING" },
                version: "v2"
            });
            expect(result.hasMore).toBe(true);
            expect(result.totalLength).toBe(120);
            expect(result.questions).toStrictEqual([
                {
                    questionId: "1",
                    questionFrontendId: "1",
                    title: "Two Sum",
                    translatedTitle: "两数之和",
                    titleSlug: "two-sum",
                    difficulty: "EASY",
                    status: "SOLVED",
                    paidOnly: false,
                    topicTags: ["array", "hash-table"]
                }
            ]);
        });

        it("forwards pagination and keyword options", async () => {
            const graphql = graphqlMock({
                data: { favoriteQuestionList: null }
            });

            const result = await fetchFavoriteQuestions(graphql, "abc", {
                limit: 10,
                skip: 20,
                searchKeyword: "sum"
            });

            expect(graphql.mock.calls[0][0].variables).toStrictEqual({
                favoriteSlug: "abc",
                limit: 10,
                skip: 20,
                searchKeyword: "sum",
                sortBy: { sortField: "CUSTOM", sortOrder: "ASCENDING" },
                version: "v2"
            });
            expect(result).toStrictEqual({
                hasMore: false,
                totalLength: 0,
                questions: []
            });
        });
    });

    describe("createFavorite", () => {
        it("creates a private NORMAL list by default", async () => {
            const graphql = graphqlMock({
                data: {
                    createEmptyFavorite: {
                        ok: true,
                        error: null,
                        favoriteSlug: "new-slug"
                    }
                }
            });

            const result = await createFavorite(graphql, { name: "My list" });

            expect(graphql.mock.calls[0][0].query).toContain(
                "createEmptyFavorite"
            );
            expect(graphql.mock.calls[0][0].variables).toStrictEqual({
                name: "My list",
                description: "",
                favoriteType: "NORMAL",
                isPublicFavorite: false
            });
            expect(result).toStrictEqual({
                ok: true,
                error: null,
                favoriteSlug: "new-slug"
            });
        });

        it("reports a rejected creation", async () => {
            const graphql = graphqlMock({
                data: {
                    createEmptyFavorite: {
                        ok: false,
                        error: "Name already exists",
                        favoriteSlug: null
                    }
                }
            });

            const result = await createFavorite(graphql, {
                name: "Dup",
                description: "desc",
                isPublic: true
            });

            expect(graphql.mock.calls[0][0].variables).toMatchObject({
                description: "desc",
                isPublicFavorite: true
            });
            expect(result).toStrictEqual({
                ok: false,
                error: "Name already exists",
                favoriteSlug: null
            });
        });
    });

    describe("updateFavoriteNameDescription", () => {
        it("always sends a description string", async () => {
            const graphql = graphqlMock({
                data: {
                    updateFavoriteNameDescriptionV2: { ok: true, error: null }
                }
            });

            const result = await updateFavoriteNameDescription(
                graphql,
                "abc",
                "Renamed"
            );

            expect(graphql.mock.calls[0][0].query).toContain(
                "updateFavoriteNameDescriptionV2"
            );
            expect(graphql.mock.calls[0][0].variables).toStrictEqual({
                favoriteSlug: "abc",
                name: "Renamed",
                description: ""
            });
            expect(result).toStrictEqual({ ok: true, error: null });
        });
    });

    describe("updateFavoriteIsPublic", () => {
        it("uses the isPublic variable name", async () => {
            const graphql = graphqlMock({
                data: { updateFavoriteIsPublicV2: { ok: true, error: null } }
            });

            await updateFavoriteIsPublic(graphql, "abc", true);

            expect(graphql.mock.calls[0][0].query).toContain(
                "updateFavoriteIsPublicV2"
            );
            expect(graphql.mock.calls[0][0].variables).toStrictEqual({
                favoriteSlug: "abc",
                isPublic: true
            });
        });
    });

    describe("addQuestionsToFavorite", () => {
        it("adds all slugs in one batch request", async () => {
            const graphql = graphqlMock({
                data: { batchAddQuestionsToFavorite: { ok: true, error: null } }
            });

            const result = await addQuestionsToFavorite(graphql, "abc", [
                "two-sum",
                "add-two-numbers"
            ]);

            expect(graphql).toHaveBeenCalledTimes(1);
            expect(graphql.mock.calls[0][0].query).toContain(
                "batchAddQuestionsToFavorite"
            );
            expect(graphql.mock.calls[0][0].variables).toStrictEqual({
                favoriteSlug: "abc",
                questionSlugs: ["two-sum", "add-two-numbers"]
            });
            expect(result).toStrictEqual({ ok: true, error: null });
        });
    });

    describe("removeQuestionsFromFavorite", () => {
        it("removes one question per request and aggregates results", async () => {
            const graphql = graphqlMock(
                {
                    data: {
                        removeQuestionFromFavoriteV2: { ok: true, error: null }
                    }
                },
                {
                    data: {
                        removeQuestionFromFavoriteV2: {
                            ok: false,
                            error: "Question not in list"
                        }
                    }
                }
            );

            const results = await removeQuestionsFromFavorite(graphql, "abc", [
                "two-sum",
                "add-two-numbers"
            ]);

            expect(graphql).toHaveBeenCalledTimes(2);
            expect(graphql.mock.calls[0][0].variables).toStrictEqual({
                favoriteSlug: "abc",
                questionSlug: "two-sum"
            });
            expect(graphql.mock.calls[1][0].variables).toStrictEqual({
                favoriteSlug: "abc",
                questionSlug: "add-two-numbers"
            });
            expect(results).toStrictEqual([
                { questionSlug: "two-sum", ok: true, error: null },
                {
                    questionSlug: "add-two-numbers",
                    ok: false,
                    error: "Question not in list"
                }
            ]);
        });

        it("continues after a GraphQL error on one question", async () => {
            const graphql = graphqlMock(
                { errors: [{ message: "boom" }], data: null },
                {
                    data: {
                        removeQuestionFromFavoriteV2: { ok: true, error: null }
                    }
                }
            );

            const results = await removeQuestionsFromFavorite(graphql, "abc", [
                "bad-slug",
                "two-sum"
            ]);

            expect(results).toStrictEqual([
                {
                    questionSlug: "bad-slug",
                    ok: false,
                    error: "removeQuestionFromFavoriteV2: boom"
                },
                { questionSlug: "two-sum", ok: true, error: null }
            ]);
        });
    });
});
