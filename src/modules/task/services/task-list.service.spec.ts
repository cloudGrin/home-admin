import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createMockLogger, createMockRepository } from '~/test-utils';
import { LoggerService } from '~/shared/logger/logger.service';
import { BusinessException } from '~/common/exceptions/business.exception';
import { TaskEntity } from '../entities/task.entity';
import { TaskListEntity, TaskListScope } from '../entities/task-list.entity';
import { TaskListService } from './task-list.service';

describe('TaskListService', () => {
  let service: TaskListService;
  let repository: jest.Mocked<Repository<TaskListEntity>>;
  let taskRepository: jest.Mocked<Repository<TaskEntity>>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TaskListService,
        {
          provide: getRepositoryToken(TaskListEntity),
          useValue: createMockRepository<TaskListEntity>(),
        },
        {
          provide: getRepositoryToken(TaskEntity),
          useValue: createMockRepository<TaskEntity>(),
        },
        { provide: LoggerService, useValue: createMockLogger() },
      ],
    }).compile();

    service = module.get(TaskListService);
    repository = module.get(getRepositoryToken(TaskListEntity));
    taskRepository = module.get(getRepositoryToken(TaskEntity));
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('creates personal active lists by default in the service layer', async () => {
    const saved = Object.assign(new TaskListEntity(), {
      id: 1,
      name: '默认清单',
      scope: TaskListScope.PERSONAL,
      sort: 0,
      isArchived: false,
      ownerId: 3,
    });
    repository.create.mockImplementation((data) => data as TaskListEntity);
    repository.save.mockResolvedValue(saved);

    await service.createList({ name: '默认清单' }, { id: 3 });

    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: '默认清单',
        scope: TaskListScope.PERSONAL,
        sort: 0,
        isArchived: false,
        ownerId: 3,
      }),
    );
  });

  it('trims task list names before saving', async () => {
    const saved = Object.assign(new TaskListEntity(), {
      id: 2,
      name: '家庭计划',
      scope: TaskListScope.PERSONAL,
      sort: 0,
      isArchived: false,
      ownerId: 3,
    });
    repository.create.mockImplementation((data) => data as TaskListEntity);
    repository.save.mockResolvedValue(saved);

    await service.createList({ name: '  家庭计划  ' }, { id: 3 });

    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: '家庭计划',
      }),
    );
  });

  it('limits normal users to family lists and their own personal lists', async () => {
    repository.find.mockResolvedValue([]);

    await service.findLists({ id: 3 } as any);

    expect(repository.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: [{ scope: TaskListScope.FAMILY }, { scope: TaskListScope.PERSONAL, ownerId: 3 }],
      }),
    );
  });

  it('does not create default lists from the read-only list query', async () => {
    repository.find.mockResolvedValue([]);

    await service.findLists({ id: 3 });

    expect(repository.findOne).not.toHaveBeenCalled();
    expect(repository.create).not.toHaveBeenCalled();
    expect(repository.save).not.toHaveBeenCalled();
  });

  it('keeps super admin personal list visibility isolated to the current user', async () => {
    repository.find.mockResolvedValue([]);

    await service.findLists({ id: 1, isSuperAdmin: true });

    expect(repository.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: [{ scope: TaskListScope.FAMILY }, { scope: TaskListScope.PERSONAL, ownerId: 1 }],
      }),
    );
  });

  it('creates default family and personal lists from the manage-only initializer', async () => {
    const familyList = Object.assign(new TaskListEntity(), {
      id: 11,
      name: '家庭',
      scope: TaskListScope.FAMILY,
      ownerId: 3,
      isArchived: false,
      sort: 0,
    });
    const personalList = Object.assign(new TaskListEntity(), {
      id: 12,
      name: '个人',
      scope: TaskListScope.PERSONAL,
      ownerId: 3,
      isArchived: false,
      sort: 0,
    });

    repository.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    repository.create.mockImplementation((data) => data as TaskListEntity);
    repository.save.mockResolvedValueOnce(familyList).mockResolvedValueOnce(personalList);
    repository.find.mockResolvedValue([familyList, personalList]);

    const result = await service.ensureDefaultLists({ id: 3 });

    expect(repository.findOne).toHaveBeenNthCalledWith(1, {
      where: {
        scope: TaskListScope.FAMILY,
        isArchived: false,
      },
      order: {
        sort: 'ASC',
        createdAt: 'ASC',
      },
    });
    expect(repository.findOne).toHaveBeenNthCalledWith(2, {
      where: {
        scope: TaskListScope.PERSONAL,
        ownerId: 3,
        isArchived: false,
      },
      order: {
        sort: 'ASC',
        createdAt: 'ASC',
      },
    });
    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: '家庭',
        scope: TaskListScope.FAMILY,
        ownerId: 3,
        isArchived: false,
        sort: 0,
      }),
    );
    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: '个人',
        scope: TaskListScope.PERSONAL,
        ownerId: 3,
        isArchived: false,
        sort: 0,
      }),
    );
    expect(result).toEqual([familyList, personalList]);
  });

  it('does not recreate defaults when active renamed lists already exist', async () => {
    repository.findOne
      .mockResolvedValueOnce(
        Object.assign(new TaskListEntity(), {
          id: 21,
          name: '房屋维修',
          scope: TaskListScope.FAMILY,
          isArchived: false,
        }),
      )
      .mockResolvedValueOnce(
        Object.assign(new TaskListEntity(), {
          id: 22,
          name: '我的事项',
          scope: TaskListScope.PERSONAL,
          ownerId: 3,
          isArchived: false,
        }),
      );
    repository.find.mockResolvedValue([]);

    await service.ensureDefaultLists({ id: 3 });

    expect(repository.save).not.toHaveBeenCalled();
  });

  it('creates active defaults when only archived lists exist', async () => {
    repository.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    repository.create.mockImplementation((data) => data as TaskListEntity);
    repository.save.mockImplementation(async (entity) => entity as TaskListEntity);
    repository.find.mockResolvedValue([]);

    await service.ensureDefaultLists({ id: 3 });

    expect(repository.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          scope: TaskListScope.FAMILY,
          isArchived: false,
        }),
      }),
    );
    expect(repository.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          scope: TaskListScope.PERSONAL,
          ownerId: 3,
          isArchived: false,
        }),
      }),
    );
    expect(repository.save).toHaveBeenCalledTimes(2);
  });

  it('rejects updating another user personal list', async () => {
    repository.findOne.mockResolvedValue(
      Object.assign(new TaskListEntity(), {
        id: 9,
        scope: TaskListScope.PERSONAL,
        ownerId: 8,
      }),
    );

    await expect((service as any).updateList(9, { name: '越权' }, { id: 3 })).rejects.toThrow(
      BusinessException,
    );
    expect(repository.save).not.toHaveBeenCalled();
  });

  it('rejects super admin updating another user personal list', async () => {
    repository.findOne.mockResolvedValue(
      Object.assign(new TaskListEntity(), {
        id: 9,
        scope: TaskListScope.PERSONAL,
        ownerId: 8,
      }),
    );

    await expect(
      (service as any).updateList(9, { name: '越权' }, { id: 3, isSuperAdmin: true }),
    ).rejects.toThrow(BusinessException);
    expect(repository.save).not.toHaveBeenCalled();
  });

  it('rejects deleting a non-empty list', async () => {
    repository.findOne.mockResolvedValue(
      Object.assign(new TaskListEntity(), {
        id: 4,
        scope: TaskListScope.FAMILY,
      }),
    );
    taskRepository.count.mockResolvedValue(1);

    await expect((service as any).removeList(4, { id: 3 })).rejects.toThrow(BusinessException);
    expect(repository.softDelete).not.toHaveBeenCalled();
  });

  it('rejects converting a non-empty family list to a personal list', async () => {
    repository.findOne.mockResolvedValue(
      Object.assign(new TaskListEntity(), {
        id: 4,
        scope: TaskListScope.FAMILY,
      }),
    );
    taskRepository.count.mockResolvedValue(1);

    await expect(
      service.updateList(4, { scope: TaskListScope.PERSONAL }, { id: 3 }),
    ).rejects.toThrow(BusinessException);
    expect(taskRepository.count).toHaveBeenCalledWith({ where: { listId: 4 } });
    expect(repository.save).not.toHaveBeenCalled();
  });
});
