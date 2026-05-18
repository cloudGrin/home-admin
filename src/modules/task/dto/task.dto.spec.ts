import { ValidationPipe } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateTaskDto } from './create-task.dto';
import { CreateTaskListDto } from './create-task-list.dto';
import { QueryTaskDto } from './query-task.dto';
import { UpdateTaskDto } from './update-task.dto';
import { UpdateTaskListDto } from './update-task-list.dto';

describe('task DTOs', () => {
  const validationPipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: {
      enableImplicitConversion: true,
    },
  });

  const transformBody = <T extends object>(metatype: new () => T, value: Record<string, unknown>) =>
    validationPipe.transform(value, {
      type: 'body',
      metatype,
    });

  it('rejects non-positive ids in create task payload', async () => {
    const dto = plainToInstance(CreateTaskDto, {
      title: '任务',
      listId: 0,
      assigneeId: -1,
    });

    const errors = await validate(dto);

    expect(errors.map((error) => error.property)).toEqual(
      expect.arrayContaining(['listId', 'assigneeId']),
    );
  });

  it('rejects blank task and list names', async () => {
    await expect(transformBody(CreateTaskDto, { title: '   ', listId: 1 })).rejects.toThrow();
    await expect(transformBody(UpdateTaskDto, { title: '   ' })).rejects.toThrow();
    await expect(transformBody(CreateTaskListDto, { name: '   ' })).rejects.toThrow();
    await expect(transformBody(UpdateTaskListDto, { name: '   ' })).rejects.toThrow();
  });

  it('requires a due time when creating tasks', async () => {
    await expect(transformBody(CreateTaskDto, { title: '任务', listId: 1 })).rejects.toThrow();
  });

  it('rejects clearing a task due time on update', async () => {
    await expect(transformBody(UpdateTaskDto, { dueAt: null })).rejects.toThrow();
  });

  it('rejects non-positive ids in task query', async () => {
    const dto = plainToInstance(QueryTaskDto, {
      listId: 0,
      assigneeId: -1,
    });

    const errors = await validate(dto);

    expect(errors.map((error) => error.property)).toEqual(
      expect.arrayContaining(['listId', 'assigneeId']),
    );
  });

  it('normalizes query tag arrays the same way as comma-separated tags', () => {
    const dto = plainToInstance(QueryTaskDto, {
      tags: [' home ', '', 'work'],
    });

    expect(dto.tags).toEqual(['home', 'work']);
  });

  it('does not materialize task defaults on partial updates', async () => {
    const dto = await transformBody(UpdateTaskDto, {
      title: '改标题',
    });

    expect(dto).toEqual({
      title: '改标题',
    });
  });

  it('does not materialize task list defaults on partial updates', async () => {
    const dto = await transformBody(UpdateTaskListDto, {
      name: '改清单',
    });

    expect(dto).toEqual({
      name: '改清单',
    });
  });

  it('rejects null for non-nullable task update fields', async () => {
    await expect(transformBody(UpdateTaskDto, { title: null })).rejects.toThrow();
    await expect(transformBody(UpdateTaskDto, { listId: null })).rejects.toThrow();
    await expect(transformBody(UpdateTaskDto, { important: null })).rejects.toThrow();
  });

  it('allows null for nullable task update fields', async () => {
    const dto = await transformBody(UpdateTaskDto, {
      description: null,
      assigneeId: null,
      remindAt: null,
      tags: null,
      recurrenceInterval: null,
    });

    expect(dto).toEqual({
      description: null,
      assigneeId: null,
      remindAt: null,
      tags: null,
      recurrenceInterval: null,
    });
  });

  it('rejects null for non-nullable task list update fields', async () => {
    await expect(transformBody(UpdateTaskListDto, { name: null })).rejects.toThrow();
    await expect(transformBody(UpdateTaskListDto, { scope: null })).rejects.toThrow();
    await expect(transformBody(UpdateTaskListDto, { sort: null })).rejects.toThrow();
  });

  it('allows null for nullable task list update fields', async () => {
    const dto = await transformBody(UpdateTaskListDto, {
      color: null,
    });

    expect(dto).toEqual({
      color: null,
    });
  });

  it('keeps create task defaults at the service layer instead of DTO transform time', async () => {
    const dto = await transformBody(CreateTaskDto, {
      title: '任务',
      listId: 1,
      dueAt: '2026-05-01T10:00:00.000Z',
    });

    expect(dto).toEqual({
      title: '任务',
      listId: 1,
      dueAt: '2026-05-01T10:00:00.000Z',
    });
  });

  it('accepts task attachments and checklist items in create payloads', async () => {
    const dto = await transformBody(CreateTaskDto, {
      title: '带附件的任务',
      listId: 1,
      dueAt: '2026-05-01T10:00:00.000Z',
      attachmentFileIds: [11, 12],
      checkItems: [
        { title: '准备材料', completed: true, sort: 0 },
        { title: '提交申请', sort: 1 },
      ],
    });

    expect(dto).toEqual({
      title: '带附件的任务',
      listId: 1,
      dueAt: '2026-05-01T10:00:00.000Z',
      attachmentFileIds: [11, 12],
      checkItems: [
        { title: '准备材料', completed: true, sort: 0 },
        { title: '提交申请', sort: 1 },
      ],
    });
  });

  it('rejects invalid task attachment and checklist item payloads', async () => {
    await expect(
      transformBody(CreateTaskDto, {
        title: '错误附件',
        listId: 1,
        attachmentFileIds: [0],
      }),
    ).rejects.toThrow();

    await expect(
      transformBody(CreateTaskDto, {
        title: '错误检查项',
        listId: 1,
        checkItems: [{ title: '   ' }],
      }),
    ).rejects.toThrow();
  });

  it('keeps create task list defaults at the service layer instead of DTO transform time', async () => {
    const dto = await transformBody(CreateTaskListDto, {
      name: '默认清单',
    });

    expect(dto).toEqual({
      name: '默认清单',
    });
  });
});
