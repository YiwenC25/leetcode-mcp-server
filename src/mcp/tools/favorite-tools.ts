import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { LeetCodeBaseService } from "../../leetcode/leetcode-base-service.js";
import { ToolRegistry } from "./tool-registry.js";

/**
 * Wraps a JSON-serializable payload in the MCP text content envelope used by
 * every tool in this server.
 */
function jsonResult(payload: unknown) {
    return {
        content: [
            {
                type: "text" as const,
                text: JSON.stringify(payload)
            }
        ]
    };
}

/**
 * Builds the standard `{ error, message }` payload for a failed tool call.
 */
function errorResult(error: string, cause?: unknown) {
    return jsonResult({
        error,
        message: cause instanceof Error ? cause.message : String(cause ?? "")
    });
}

/**
 * Problem list tool registry class that handles registration of LeetCode
 * problem list ("favorites") tools. These tools let the authenticated user
 * view, create and edit their own problem lists on both LeetCode Global and
 * LeetCode CN.
 */
export class FavoriteToolRegistry extends ToolRegistry {
    /**
     * Registers problem list tools. All of them require authentication and are
     * available on both Global and CN platforms.
     */
    protected registerAuthenticatedCommon(): void {
        // List the current user's problem lists (requires authentication)
        this.server.tool(
            "list_problem_lists",
            "Lists the authenticated user's problem lists (read-only, requires auth). Returns each list's slug, name, visibility and question count as JSON. The slug (the URL segment after /problem-list/) identifies a list in the other problem-list tools. Set includeCollected to also return lists saved from other creators. Use get_problem_list to see the questions inside a list.",
            {
                includeCollected: z
                    .boolean()
                    .optional()
                    .default(false)
                    .describe(
                        "Also return problem lists the user has saved (collected) from other creators (default: false)"
                    )
            },
            async ({ includeCollected }) => {
                try {
                    const data =
                        await this.leetcodeService.fetchMyFavoriteLists({
                            includeCollected
                        });
                    return jsonResult(data);
                } catch (error) {
                    return errorResult("Failed to list problem lists", error);
                }
            }
        );

        // Problem list detail + questions (requires authentication)
        this.server.tool(
            "get_problem_list",
            "Retrieves a problem list's metadata and a page of its questions by favoriteSlug (read-only, requires auth). Supports limit/skip pagination and keyword search; each question includes titleSlug, difficulty and the user's status. Use list_problem_lists to find the slug; use get_problem to fetch the full description of a single question.",
            {
                favoriteSlug: z
                    .string()
                    .describe(
                        "Problem list slug from list_problem_lists, or the URL segment after /problem-list/"
                    ),
                limit: z
                    .number()
                    .optional()
                    .default(50)
                    .describe("Max questions per page (default: 50)"),
                skip: z
                    .number()
                    .optional()
                    .default(0)
                    .describe("Questions to skip for pagination (default: 0)"),
                searchKeyword: z
                    .string()
                    .optional()
                    .describe(
                        "Keyword to filter questions by title. Omit for all questions."
                    )
            },
            async ({ favoriteSlug, limit, skip, searchKeyword }) => {
                try {
                    const list =
                        await this.leetcodeService.fetchFavoriteDetail(
                            favoriteSlug
                        );
                    const page =
                        await this.leetcodeService.fetchFavoriteQuestions(
                            favoriteSlug,
                            { limit, skip, searchKeyword }
                        );
                    return jsonResult({
                        favoriteSlug,
                        list,
                        filters: { searchKeyword },
                        pagination: {
                            limit,
                            skip,
                            totalLength: page.totalLength,
                            hasMore: page.hasMore
                        },
                        questions: page.questions
                    });
                } catch (error) {
                    return errorResult("Failed to get problem list", error);
                }
            }
        );

        // Create a problem list (requires authentication)
        this.server.tool(
            "create_problem_list",
            "Creates a new problem list for the authenticated user (write operation, requires auth). Optionally adds an initial set of questions by titleSlug. Returns { success, favoriteSlug, error, added } as JSON; keep favoriteSlug for later edits. Use add_problems_to_list to add questions to an existing list and update_problem_list to rename it or change its visibility.",
            {
                name: z
                    .string()
                    .min(1)
                    .describe("Display name of the new list"),
                description: z
                    .string()
                    .optional()
                    .default("")
                    .describe("Optional description of the list"),
                isPublic: z
                    .boolean()
                    .optional()
                    .default(false)
                    .describe(
                        "Make the list publicly visible (default: false = private)"
                    ),
                questionSlugs: z
                    .array(z.string())
                    .optional()
                    .describe(
                        "Optional problem slugs to add right after creation, e.g. ['two-sum', 'add-two-numbers']"
                    )
            },
            async ({ name, description, isPublic, questionSlugs }) => {
                try {
                    const created = await this.leetcodeService.createFavorite({
                        name,
                        description,
                        isPublic
                    });

                    const response: Record<string, unknown> = {
                        success: created.ok,
                        favoriteSlug: created.favoriteSlug,
                        error: created.error
                    };

                    if (
                        created.ok &&
                        created.favoriteSlug &&
                        questionSlugs &&
                        questionSlugs.length > 0
                    ) {
                        response.added =
                            await this.leetcodeService.addQuestionsToFavorite(
                                created.favoriteSlug,
                                questionSlugs
                            );
                    }

                    return jsonResult(response);
                } catch (error) {
                    return errorResult("Failed to create problem list", error);
                }
            }
        );

        // Rename / describe / toggle visibility of a problem list (requires authentication)
        this.server.tool(
            "update_problem_list",
            "Renames a problem list, changes its description, and/or toggles its public visibility (write operation, requires auth). Provide at least one of name, description, isPublic; omitted fields keep their current value. Does not change the questions in the list—use add_problems_to_list or remove_problems_from_list for that.",
            {
                favoriteSlug: z
                    .string()
                    .describe("Problem list slug from list_problem_lists"),
                name: z
                    .string()
                    .min(1)
                    .optional()
                    .describe(
                        "New display name. Omit to keep the current name."
                    ),
                description: z
                    .string()
                    .optional()
                    .describe(
                        "New description. Omit to keep the current description."
                    ),
                isPublic: z
                    .boolean()
                    .optional()
                    .describe(
                        "true = public, false = private. Omit to keep the current visibility."
                    )
            },
            async ({ favoriteSlug, name, description, isPublic }) => {
                if (
                    name === undefined &&
                    description === undefined &&
                    isPublic === undefined
                ) {
                    return errorResult(
                        "Failed to update problem list",
                        new Error(
                            "Provide at least one of name, description or isPublic"
                        )
                    );
                }

                try {
                    const response: Record<string, unknown> = { favoriteSlug };

                    if (name !== undefined || description !== undefined) {
                        // LeetCode requires both fields on every call, so fill the
                        // omitted one from the list's current metadata.
                        const current =
                            name === undefined || description === undefined
                                ? await this.leetcodeService.fetchFavoriteDetail(
                                      favoriteSlug
                                  )
                                : undefined;
                        const nextName: string =
                            name ?? String(current?.name ?? "");
                        const nextDescription: string =
                            description ?? String(current?.description ?? "");

                        response.nameDescription =
                            await this.leetcodeService.updateFavoriteNameDescription(
                                favoriteSlug,
                                nextName,
                                nextDescription
                            );
                    }

                    if (isPublic !== undefined) {
                        response.visibility =
                            await this.leetcodeService.updateFavoriteIsPublic(
                                favoriteSlug,
                                isPublic
                            );
                    }

                    return jsonResult(response);
                } catch (error) {
                    return errorResult("Failed to update problem list", error);
                }
            }
        );

        // Add questions to a problem list (requires authentication)
        this.server.tool(
            "add_problems_to_list",
            "Adds one or more problems to an existing problem list by titleSlug (write operation, requires auth). Returns { success, error } as JSON. Use list_problem_lists to find the favoriteSlug and search_problems to find problem slugs; use create_problem_list to start a new list.",
            {
                favoriteSlug: z
                    .string()
                    .describe("Problem list slug from list_problem_lists"),
                questionSlugs: z
                    .array(z.string())
                    .min(1)
                    .describe(
                        "Problem slugs to add, e.g. ['two-sum', 'add-two-numbers']"
                    )
            },
            async ({ favoriteSlug, questionSlugs }) => {
                try {
                    const result =
                        await this.leetcodeService.addQuestionsToFavorite(
                            favoriteSlug,
                            questionSlugs
                        );
                    return jsonResult({
                        favoriteSlug,
                        questionSlugs,
                        success: result.ok,
                        error: result.error
                    });
                } catch (error) {
                    return errorResult("Failed to add problems to list", error);
                }
            }
        );

        // Remove questions from a problem list (requires authentication)
        this.server.tool(
            "remove_problems_from_list",
            "Removes one or more problems from a problem list by titleSlug (write operation, requires auth). Each problem is removed individually and reported as { questionSlug, ok, error }. Use get_problem_list to see which problems a list currently contains.",
            {
                favoriteSlug: z
                    .string()
                    .describe("Problem list slug from list_problem_lists"),
                questionSlugs: z
                    .array(z.string())
                    .min(1)
                    .describe(
                        "Problem slugs to remove, e.g. ['two-sum', 'add-two-numbers']"
                    )
            },
            async ({ favoriteSlug, questionSlugs }) => {
                try {
                    const results =
                        await this.leetcodeService.removeQuestionsFromFavorite(
                            favoriteSlug,
                            questionSlugs
                        );
                    return jsonResult({
                        favoriteSlug,
                        success: results.every(
                            (result: { ok: boolean }) => result.ok
                        ),
                        results
                    });
                } catch (error) {
                    return errorResult(
                        "Failed to remove problems from list",
                        error
                    );
                }
            }
        );
    }
}

/**
 * Registers all problem list related tools with the MCP server.
 *
 * @param server - The MCP server instance to register tools with
 * @param leetcodeService - The LeetCode service implementation to use for API calls
 */
export function registerFavoriteTools(
    server: McpServer,
    leetcodeService: LeetCodeBaseService
): void {
    const registry = new FavoriteToolRegistry(server, leetcodeService);
    registry.registerTools();
}
