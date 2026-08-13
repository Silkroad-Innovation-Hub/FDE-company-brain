const express = require('express');
const { logger } = require('@librechat/data-schemas');
const { getTodos, createTodo, updateTodo, deleteTodo } = require('~/models');
const { requireJwtAuth } = require('~/server/middleware');

const router = express.Router();

router.use(requireJwtAuth);

router.get('/', async (req, res) => {
  try {
    const todos = await getTodos(req.user.id);
    res.status(200).json(todos);
  } catch (error) {
    logger.error('Error getting todos:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/', async (req, res) => {
  try {
    if (!req.body.text || typeof req.body.text !== 'string') {
      return res.status(400).json({ error: 'text is required' });
    }
    const todo = await createTodo(req.user.id, req.body);
    res.status(201).json(todo);
  } catch (error) {
    logger.error('Error creating todo:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/:todoId', async (req, res) => {
  try {
    const todo = await updateTodo(req.user.id, req.params.todoId, req.body);
    if (!todo) {
      return res.status(404).json({ error: 'Todo not found' });
    }
    res.status(200).json(todo);
  } catch (error) {
    logger.error('Error updating todo:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/:todoId', async (req, res) => {
  try {
    const deleted = await deleteTodo(req.user.id, req.params.todoId);
    if (!deleted) {
      return res.status(404).json({ error: 'Todo not found' });
    }
    res.status(200).json({ deleted: true });
  } catch (error) {
    logger.error('Error deleting todo:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
