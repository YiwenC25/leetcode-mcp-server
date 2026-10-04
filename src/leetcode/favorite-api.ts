import {
    BATCH_ADD_QUESTIONS_TO_FAVORITE_MUTATION,
    CREATE_FAVORITE_MUTATION,
    FAVORITE_DETAIL_QUERY,
    FAVORITE_QUESTION_LIST_QUERY,
    MY_COLLECTED_FAVORITE_LISTS_QUERY,
    MY_CREATED_FAVORITE_LISTS_QUERY,
    REMOVE_QUESTION_FROM_FAVORITE_MUTATION,
    UPDATE_FAVORITE_IS_PUBLIC_MUTATION,
    UPDATE_FAVORITE_NAME_DESCRIPTION_MUTATION
} from "./graphql/common/favorite-queries.js";

/**
 * Shared implementation of the LeetCode problem list ("favorites") operations.
 *
 * LeetCode Global and LeetCode CN expose the same V2 favorites GraphQL API, so
 * both service implementations delegate to these functions. Each function takes
 * a GraphQL executor (the `graphql` method of a leetcode-query client), which is
 * responsible for sending the session cookie and CSRF token.
 */

/**
 * A GraphQL request as accepted by leetcode-query's `graphql` method.
 */
export interface GraphQLRequest {
    query: string;
    variables?: Record<string, unknown>;
}

/**
 * Executes a GraphQL request and resolves to the raw response body
 * (`{ data, errors? }`).
 */
export type GraphQLExecutor = (request: GraphQLRequest) => Promise<any>;

/**
 * The favorite type used for all user-created problem lists.
 */
export const FAVORITE_TYPE_NORMAL = "NORMAL";

/**
 * Default page size when listing the questions of a problem list.
 */
export const DEFAULT_FAVORITE_QUESTIONS_LIMIT = 50;

/**
 * Result shape shared by all favorites mutations.
 */
export interface FavoriteMutationResult {
    ok: boolean;
    error: string | null;
}

/**
 * Extracts `data` from a GraphQL response, throwing when the response carries
 * GraphQL errors. LeetCode answers HTTP 200 even for failed operations, so the
 * `errors` array must be checked explicitly.
 *
 * @param response - Raw GraphQL response body
 * @param context - Operation name used in the error message
 * @returns The `data` object of the response (empty object when absent)
 * @throws Error when the response contains GraphQL errors
 */
export function unwrapGraphQL(response: any, context: string): any {
    const errors = response?.errors;
    if (Array.isArray(errors) && errors.length > 0) {
        const messages = errors
            .map((error: any) =>
                typeof error?.message === "string"
                    ? error.message
                    : JSON.stringify(error)
            )
            .join("; ");
        throw new Error(`${context}: ${messages}`);
    }
    return response?.data ?? {};
}

function normalizeMutationResult(result: any): FavoriteMutationResult {
    return {
        ok: result?.ok === true,
        error: result?.error ?? null
    };
}

function normalizeFavoritePage(page: any) {
    return {
        hasMore: page?.hasMore ?? false,
        totalLength: page?.totalLength ?? 0,
        favorites: Array.isArray(page?.favorites) ? page.favorites : []
    };
}

/**
 * Retrieves the problem lists owned by the authenticated user and, optionally,
 * the lists the user has saved from other creators.
 *
 * @param graphql - GraphQL executor bound to an authenticated client
 * @param options.includeCollected - Also fetch saved (collected) lists
 * @returns `{ created, collected? }`, each with `hasMore`, `totalLength`, `favorites`
 */
export async function fetchMyFavoriteLists(
    graphql: GraphQLExecutor,
    options?: { includeCollected?: boolean }
): Promise<any> {
    const createdData = unwrapGraphQL(
        await graphql({ query: MY_CREATED_FAVORITE_LISTS_QUERY }),
        "myCreatedFavoriteList"
    );

    const result: Record<string, unknown> = {
        created: normalizeFavoritePage(createdData.myCreatedFavoriteList)
    };

    if (options?.includeCollected) {
        const collectedData = unwrapGraphQL(
            await graphql({ query: MY_COLLECTED_FAVORITE_LISTS_QUERY }),
            "myCollectedFavoriteList"
        );
        result.collected = normalizeFavoritePage(
            collectedData.myCollectedFavoriteList
        );
    }

    return result;
}

/**
 * Retrieves the metadata of a single problem list.
 *
 * @param graphql - GraphQL executor bound to an authenticated client
 * @param favoriteSlug - Slug of the problem list
 * @returns The list metadata (slug, name, description, visibility, size, creator)
 * @throws Error when the list does not exist or is not visible to the user
 */
export async function fetchFavoriteDetail(
    graphql: GraphQLExecutor,
    favoriteSlug: string
): Promise<any> {
    const data = unwrapGraphQL(
        await graphql({
            query: FAVORITE_DETAIL_QUERY,
            variables: { favoriteSlug }
        }),
        "favoriteDetailV2"
    );

    if (!data.favoriteDetailV2) {
        throw new Error(`Problem list ${favoriteSlug} not found`);
    }

    return data.favoriteDetailV2;
}

/**
 * Retrieves a page of the questions contained in a problem list.
 *
 * @param graphql - GraphQL executor bound to an authenticated client
 * @param favoriteSlug - Slug of the problem list
 * @param options.limit - Maximum number of questions to return (default: 50)
 * @param options.skip - Number of questions to skip (default: 0)
 * @param options.searchKeyword - Optional keyword to filter questions by title
 * @returns `{ hasMore, totalLength, questions }` with simplified question entries
 */
export async function fetchFavoriteQuestions(
    graphql: GraphQLExecutor,
    favoriteSlug: string,
    options?: { limit?: number; skip?: number; searchKeyword?: string }
): Promise<any> {
    const variables = {
        favoriteSlug,
        limit: options?.limit ?? DEFAULT_FAVORITE_QUESTIONS_LIMIT,
        skip: options?.skip ?? 0,
        searchKeyword: options?.searchKeyword
    };

    const data = unwrapGraphQL(
        await graphql({ query: FAVORITE_QUESTION_LIST_QUERY, variables }),
        "favoriteQuestionList"
    );

    const list = data.favoriteQuestionList;
    if (!list) {
        return { hasMore: false, totalLength: 0, questions: [] };
    }

    const questions = Array.isArray(list.questions) ? list.questions : [];
    return {
        hasMore: list.hasMore ?? false,
        totalLength: list.totalLength ?? questions.length,
        questions: questions.map((question: any) => ({
            questionId: question.id,
            questionFrontendId: question.questionFrontendId,
            title: question.title,
            translatedTitle: question.translatedTitle,
            titleSlug: question.titleSlug,
            difficulty: question.difficulty,
            status: question.status,
            paidOnly: question.paidOnly,
            topicTags: (question.topicTags ?? []).map((tag: any) => tag.slug)
        }))
    };
}

/**
 * Creates a new, empty problem list.
 *
 * @param graphql - GraphQL executor bound to an authenticated client
 * @param options.name - Display name of the list
 * @param options.description - Optional description (default: "")
 * @param options.isPublic - Whether the list is public (default: false)
 * @returns `{ ok, error, favoriteSlug }`
 */
export async function createFavorite(
    graphql: GraphQLExecutor,
    options: { name: string; description?: string; isPublic?: boolean }
): Promise<FavoriteMutationResult & { favoriteSlug: string | null }> {
    const variables = {
        name: options.name,
        description: options.description ?? "",
        favoriteType: FAVORITE_TYPE_NORMAL,
        isPublicFavorite: options.isPublic ?? false
    };

    const data = unwrapGraphQL(
        await graphql({ query: CREATE_FAVORITE_MUTATION, variables }),
        "createEmptyFavorite"
    );

    const result = data.createEmptyFavorite;
    return {
        ...normalizeMutationResult(result),
        favoriteSlug: result?.favoriteSlug ?? null
    };
}

/**
 * Renames a problem list and/or updates its description. LeetCode requires the
 * name on every call, so callers that only change the description must pass the
 * current name.
 *
 * @param graphql - GraphQL executor bound to an authenticated client
 * @param favoriteSlug - Slug of the problem list
 * @param name - New (or unchanged) display name
 * @param description - New (or unchanged) description (default: "")
 * @returns `{ ok, error }`
 */
export async function updateFavoriteNameDescription(
    graphql: GraphQLExecutor,
    favoriteSlug: string,
    name: string,
    description?: string
): Promise<FavoriteMutationResult> {
    const data = unwrapGraphQL(
        await graphql({
            query: UPDATE_FAVORITE_NAME_DESCRIPTION_MUTATION,
            variables: { favoriteSlug, name, description: description ?? "" }
        }),
        "updateFavoriteNameDescriptionV2"
    );

    return normalizeMutationResult(data.updateFavoriteNameDescriptionV2);
}

/**
 * Changes the public visibility of a problem list.
 *
 * @param graphql - GraphQL executor bound to an authenticated client
 * @param favoriteSlug - Slug of the problem list
 * @param isPublic - True to make the list public, false for private
 * @returns `{ ok, error }`
 */
export async function updateFavoriteIsPublic(
    graphql: GraphQLExecutor,
    favoriteSlug: string,
    isPublic: boolean
): Promise<FavoriteMutationResult> {
    const data = unwrapGraphQL(
        await graphql({
            query: UPDATE_FAVORITE_IS_PUBLIC_MUTATION,
            variables: { favoriteSlug, isPublic }
        }),
        "updateFavoriteIsPublicV2"
    );

    return normalizeMutationResult(data.updateFavoriteIsPublicV2);
}

/**
 * Adds questions to a problem list in a single request.
 *
 * @param graphql - GraphQL executor bound to an authenticated client
 * @param favoriteSlug - Slug of the problem list
 * @param questionSlugs - Title slugs of the questions to add
 * @returns `{ ok, error }`
 */
export async function addQuestionsToFavorite(
    graphql: GraphQLExecutor,
    favoriteSlug: string,
    questionSlugs: string[]
): Promise<FavoriteMutationResult> {
    const data = unwrapGraphQL(
        await graphql({
            query: BATCH_ADD_QUESTIONS_TO_FAVORITE_MUTATION,
            variables: { favoriteSlug, questionSlugs }
        }),
        "batchAddQuestionsToFavorite"
    );

    return normalizeMutationResult(data.batchAddQuestionsToFavorite);
}

/**
 * Removes questions from a problem list. The API removes one question per
 * request, so the questions are processed sequentially and the outcome of each
 * removal is reported individually.
 *
 * @param graphql - GraphQL executor bound to an authenticated client
 * @param favoriteSlug - Slug of the problem list
 * @param questionSlugs - Title slugs of the questions to remove
 * @returns One `{ questionSlug, ok, error }` entry per requested question
 */
export async function removeQuestionsFromFavorite(
    graphql: GraphQLExecutor,
    favoriteSlug: string,
    questionSlugs: string[]
): Promise<Array<FavoriteMutationResult & { questionSlug: string }>> {
    const results: Array<FavoriteMutationResult & { questionSlug: string }> =
        [];

    for (const questionSlug of questionSlugs) {
        try {
            const data = unwrapGraphQL(
                await graphql({
                    query: REMOVE_QUESTION_FROM_FAVORITE_MUTATION,
                    variables: { favoriteSlug, questionSlug }
                }),
                "removeQuestionFromFavoriteV2"
            );
            results.push({
                questionSlug,
                ...normalizeMutationResult(data.removeQuestionFromFavoriteV2)
            });
        } catch (error: any) {
            results.push({
                questionSlug,
                ok: false,
                error: error?.message ?? String(error)
            });
        }
    }

    return results;
}
