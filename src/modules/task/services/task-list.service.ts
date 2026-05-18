import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BusinessException } from '~/common/exceptions/business.exception';
import { LoggerService } from '~/shared/logger/logger.service';
import { CreateTaskListDto, UpdateTaskListDto } from '../dto';
import { TaskEntity } from '../entities/task.entity';
import { TaskListEntity, TaskListScope } from '../entities/task-list.entity';

interface CurrentUserLike {
  id: number;
  isSuperAdmin?: boolean;
  roleCode?: string;
  roles?: string[];
}

@Injectable()
export class TaskListService {
  constructor(
    @InjectRepository(TaskListEntity)
    private readonly taskListRepository: Repository<TaskListEntity>,
    @InjectRepository(TaskEntity)
    private readonly taskRepository: Repository<TaskEntity>,
    private readonly logger: LoggerService,
  ) {}

  async createList(dto: CreateTaskListDto, user: CurrentUserLike): Promise<TaskListEntity> {
    const entity = this.taskListRepository.create({
      ...dto,
      name: this.normalizeName(dto.name),
      ownerId: user.id,
      scope: dto.scope ?? TaskListScope.PERSONAL,
      isArchived: dto.isArchived ?? false,
      sort: dto.sort ?? 0,
    });

    const saved = await this.taskListRepository.save(entity);
    this.logger.log(`Created task list "${saved.name}" by user ${user.id}`);
    return saved;
  }

  async findLists(user: CurrentUserLike): Promise<TaskListEntity[]> {
    return this.taskListRepository.find({
      where: [{ scope: TaskListScope.FAMILY }, { scope: TaskListScope.PERSONAL, ownerId: user.id }],
      order: {
        sort: 'ASC',
        createdAt: 'ASC',
      },
    });
  }

  async ensureDefaultLists(user: CurrentUserLike): Promise<TaskListEntity[]> {
    await this.ensureActiveFamilyList(user);
    await this.ensureActivePersonalList(user);
    return this.findLists(user);
  }

  async updateList(
    id: number,
    dto: UpdateTaskListDto,
    user: CurrentUserLike,
  ): Promise<TaskListEntity> {
    const entity = await this.findById(id);
    this.ensureCanManageList(entity, user);
    await this.ensureCanChangeScope(entity, dto.scope);
    Object.assign(entity, {
      ...dto,
      ...(dto.name !== undefined ? { name: this.normalizeName(dto.name) } : {}),
    });
    return this.taskListRepository.save(entity);
  }

  async removeList(id: number, user: CurrentUserLike): Promise<void> {
    const entity = await this.findById(id);
    this.ensureCanManageList(entity, user);

    const taskCount = await this.taskRepository.count({ where: { listId: id } });
    if (taskCount > 0) {
      throw BusinessException.validationFailed('清单下仍有任务，不能删除');
    }

    const result = await this.taskListRepository.softDelete(id);
    if (!result.affected) {
      throw BusinessException.notFound('Task list', id);
    }
  }

  private async findById(id: number): Promise<TaskListEntity> {
    const entity = await this.taskListRepository.findOne({ where: { id } });
    if (!entity) {
      throw BusinessException.notFound('Task list', id);
    }

    return entity;
  }

  private ensureCanManageList(list: TaskListEntity, user: CurrentUserLike): void {
    if (list.scope === TaskListScope.FAMILY) {
      return;
    }

    if (list.ownerId === user.id) {
      return;
    }

    throw BusinessException.notFound('Task list', list.id);
  }

  private async ensureCanChangeScope(
    list: TaskListEntity,
    nextScope?: TaskListScope,
  ): Promise<void> {
    if (list.scope !== TaskListScope.FAMILY || nextScope !== TaskListScope.PERSONAL) {
      return;
    }

    const taskCount = await this.taskRepository.count({ where: { listId: list.id } });
    if (taskCount > 0) {
      throw BusinessException.validationFailed('家庭清单下仍有任务，不能改为个人清单');
    }
  }

  private normalizeName(value: string): string {
    const name = value.trim();
    if (!name) {
      throw BusinessException.validationFailed('清单名称不能为空');
    }

    return name;
  }

  private async ensureActiveFamilyList(user: CurrentUserLike): Promise<void> {
    const existing = await this.taskListRepository.findOne({
      where: {
        scope: TaskListScope.FAMILY,
        isArchived: false,
      },
      order: {
        sort: 'ASC',
        createdAt: 'ASC',
      },
    });

    if (existing) {
      return;
    }

    await this.createDefaultList('家庭', TaskListScope.FAMILY, user);
  }

  private async ensureActivePersonalList(user: CurrentUserLike): Promise<void> {
    const existing = await this.taskListRepository.findOne({
      where: {
        scope: TaskListScope.PERSONAL,
        ownerId: user.id,
        isArchived: false,
      },
      order: {
        sort: 'ASC',
        createdAt: 'ASC',
      },
    });

    if (existing) {
      return;
    }

    await this.createDefaultList('个人', TaskListScope.PERSONAL, user);
  }

  private async createDefaultList(
    name: string,
    scope: TaskListScope,
    user: CurrentUserLike,
  ): Promise<TaskListEntity> {
    const entity = this.taskListRepository.create({
      name,
      scope,
      ownerId: user.id,
      isArchived: false,
      sort: 0,
    });

    const saved = await this.taskListRepository.save(entity);
    this.logger.log(`Created default task list "${saved.name}" by user ${user.id}`);
    return saved;
  }
}
