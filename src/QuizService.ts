import { WebClientService } from "arrmatura-web/core";
import { arrayShuffle } from "ultimus";

export class QuizService extends WebClientService {
  quiz?: any[];
  quizIndex = 0;
  questionNumber = 0;
  attemptsCount = 0;
  selectedAnswerId: string | null = null;
  quizDone = false;

  constructor() {
    super();
    this.__defineStoredProperty("answerStatuses", (v) => v ?? {});
    this.__defineStoredProperty("failedCounts", (v) => v ?? {});
    this.__defineStoredProperty("shownAt", (v) => v ?? {});
    this.__defineStoredProperty("selectedTopic", (v) => v ?? "");
    this.__defineStoredProperty("selectedTag", (v) => v ?? "");

    this.__defineCalculatedProperties({
      "availableTopics(quiz)": (quiz: any[] | undefined) => {
        const counts = new Map<string, number>();
        (quiz ?? []).forEach((q) =>
          q.topics
            ?.filter(Boolean)
            .forEach((t: string) => counts.set(t, (counts.get(t) ?? 0) + 1)),
        );
        const total = quiz?.length ?? 0;
        return [{ id: "**", name: `All (${total})` }].concat(
          [...counts.keys()]
            .sort()
            .map((id) => ({ id, name: `${id} (${counts.get(id)})` })),
        );
      },
      "availableTags(quiz)": (quiz: any[] | undefined) => {
        const counts = new Map<string, number>();
        (quiz ?? []).forEach((q) =>
          q.tags
            ?.filter(Boolean)
            .forEach((tag: string) =>
              counts.set(tag, (counts.get(tag) ?? 0) + 1),
            ),
        );
        const total = quiz?.length ?? 0;
        return [{ id: "**", name: `All Tags (${total})` }].concat(
          [...counts.keys()]
            .sort()
            .map((id) => ({ id, name: `${id} (${counts.get(id)})` })),
        );
      },
      "filteredQuiz(quiz,selectedTopic,selectedTag,answerStatuses,failedCounts)":
        (
          quiz: any[] | undefined,
          topic: string,
          tag: string,
          statuses: Record<string, string>,
          failedCounts: Record<string, number>,
        ) => {
          const enrich = (q: any) => ({
            ...q,
            status: statuses[q.id] ?? null,
            failedCount: failedCounts[q.id] ?? 0,
          });
          const all = quiz ?? [];
          const matched = all.filter(
            (q) =>
              (!topic || q.topics?.includes(topic)) &&
              (!tag || q.tags?.includes(tag)),
          );
          return matched.map(enrich);
        },
      "currentQuestion(quizIndex,filteredQuiz)": (
        idx: number,
        quiz: any[] | undefined,
      ) => quiz?.[idx] ?? null,
      "totalQuestions(filteredQuiz)": (quiz: any[] | undefined) =>
        quiz?.length ?? 0,
      "quizScore(answerStatuses,filteredQuiz)": (
        statuses: Record<string, string>,
        quiz: any[] | undefined,
      ) => (quiz ?? []).filter((q) => statuses[q.id] === "ok").length,
      "answeredCount(answerStatuses,filteredQuiz)": (
        statuses: Record<string, string>,
        quiz: any[] | undefined,
      ) => (quiz ?? []).filter((q) => !!statuses[q.id]).length,
      "failedCount(answerStatuses,filteredQuiz)": (
        statuses: Record<string, string>,
        quiz: any[] | undefined,
      ) => (quiz ?? []).filter((q) => statuses[q.id] === "fail").length,
      "masteredPercent(quizScore,totalQuestions)": (
        score: number,
        total: number,
      ) => (total ? Math.round((score / total) * 100) : 0),
      "failedPercent(failedCount,totalQuestions)": (
        failed: number,
        total: number,
      ) => (total ? Math.round((failed / total) * 100) : 0),
      "accuracyPercent(quizScore,answeredCount)": (
        score: number,
        answeredCount: number,
      ) => (answeredCount ? Math.round((100 * score) / answeredCount) : 0),
      "filtersActive(selectedTopic,selectedTag)": (
        topic: string,
        tag: string,
      ) => topic || tag,
    });
  }

  __init(): void {
    this.nextQuestion();
  }

  selectTopic(selectedTopic) {
    this.up({ selectedTopic: selectedTopic === "**" ? "" : selectedTopic });
    this.resetFilteredSession();
  }

  selectTag(selectedTag) {
    this.up({ selectedTag: selectedTag === "**" ? "" : selectedTag });
    this.resetFilteredSession();
  }

  clearFilters() {
    this.up({ selectedTopic: "", selectedTag: "" });
    this.resetFilteredSession();
  }

  resetFilteredSession() {
    this.up({
      quizIndex: 0,
      questionNumber: 0,
      attemptsCount: 0,
      selectedAnswerId: null,
      quizDone: false,
    });
    this.nextQuestion();
  }

  selectAnswer(answerId: string) {
    if (this.selectedAnswerId) return;
    const q = (this as any).currentQuestion;
    if (!q) return;
    const correct =
      q.answers.find((a: any) => a.id === answerId)?.isCorrect ?? false;
    const statuses = (this as any).answerStatuses as Record<string, string>;
    const failedCounts = (this as any).failedCounts as Record<string, number>;
    this.up({
      selectedAnswerId: answerId,
      attemptsCount: (this.attemptsCount as number) + 1,
      answerStatuses: { ...statuses, [q.id]: correct ? "ok" : "fail" },
      failedCounts: correct
        ? failedCounts
        : { ...failedCounts, [q.id]: (failedCounts[q.id] ?? 0) + 1 },
    });
  }

  nextQuestion() {
    const quiz: any[] = ((this as any).filteredQuiz as any[]) ?? [];
    const statuses = (this as any).answerStatuses as Record<string, string>;

    if (quiz.length && quiz.every((q) => statuses[q.id] === "ok")) {
      this.up({ quizDone: true, selectedAnswerId: null });
      return;
    }

    const failed = quiz.filter((q) => statuses[q.id] === "fail");
    const unanswered = quiz.filter((q) => !statuses[q.id]);
    const ok = quiz.filter((q) => statuses[q.id] === "ok");
    const prioritized = [
      ...arrayShuffle(failed),
      ...arrayShuffle(unanswered),
      ...arrayShuffle(ok),
    ];

    const COOLDOWN_MS = 60 * 60_000;
    const shownAt = (this as any).shownAt as Record<string, number>;
    const now = Date.now();
    const isCool = (q: any) =>
      !shownAt[q.id] || now - shownAt[q.id] >= COOLDOWN_MS;

    const current = quiz[this.quizIndex as number];
    const pool = prioritized.filter((q) => q !== current);
    const cooled = pool.filter(isCool);
    const candidates = cooled.length
      ? cooled
      : pool.length
        ? pool
        : prioritized;
    const next = candidates[0];
    if (!next) return;

    this.up({
      quizIndex: quiz.indexOf(next),
      questionNumber: (this.questionNumber as number) + 1,
      selectedAnswerId: null,
      shownAt: { ...shownAt, [next.id]: now },
    });
  }

  restartQuiz() {
    this.up({
      quizIndex: 0,
      questionNumber: 0,
      attemptsCount: 0,
      selectedAnswerId: null,
      quizDone: false,
      answerStatuses: {},
      failedCounts: {},
      shownAt: {},
    });
    this.nextQuestion();
  }

  openLink(src) {
    if (src.type === "doc") {
      window.location.hash = `/?doc=${encodeURIComponent(src.ref)}`;
    } else {
      window.open(src.ref, "_blank", "noopener");
    }
  }
}
