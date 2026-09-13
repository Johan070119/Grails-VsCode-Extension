export type ResourceFactory<T> = (signal: AbortSignal) => Promise<T[]>;
export type ResourceStopper<T> = (resource: T) => Promise<unknown>;

export class RestartableResources<T> {
    private resources: T[] = [];
    private generation = 0;
    private queue: Promise<void> = Promise.resolve();
    private controller: AbortController | null = null;
    private disposed = false;

    constructor(
        private readonly create: ResourceFactory<T>,
        private readonly stop: ResourceStopper<T>,
    ) {}

    getAll(): readonly T[] {
        return [...this.resources];
    }

    restart(): Promise<void> {
        if (this.disposed) return Promise.resolve();
        const generation = ++this.generation;
        this.controller?.abort();
        const controller = new AbortController();
        this.controller = controller;

        const operation = this.queue.catch(() => undefined).then(async () => {
            await this.stopAll(this.resources);
            this.resources = [];
            if (this.disposed || generation !== this.generation) return;

            let created: T[] = [];
            try {
                created = await this.create(controller.signal);
            } catch (error) {
                if (!controller.signal.aborted) throw error;
            }
            if (this.disposed || controller.signal.aborted || generation !== this.generation) {
                await this.stopAll(created);
                return;
            }
            this.resources = created;
        });
        this.queue = operation.catch(() => undefined);
        return operation;
    }

    async dispose(): Promise<void> {
        if (this.disposed) return;
        this.disposed = true;
        this.generation++;
        this.controller?.abort();
        await this.queue.catch(() => undefined);
        await this.stopAll(this.resources);
        this.resources = [];
    }

    private async stopAll(resources: readonly T[]): Promise<void> {
        await Promise.allSettled(resources.map((resource) => this.stop(resource)));
    }
}
