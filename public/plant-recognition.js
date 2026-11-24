const MODEL = 'Xenova/clip-vit-base-patch32';

export const ENGLISH_NAMES = {
  'Томат': 'tomato',
  'Огурец': 'long green cucumber',
  'Картофель': 'potato',
  'Морковь': 'carrot',
  'Капуста': 'cabbage',
  'Лук': 'onion',
  'Чеснок': 'garlic',
  'Перец': 'bell pepper',
  'Баклажан': 'eggplant',
  'Свёкла': 'beetroot',
  'Кабачок': 'green zucchini squash',
  'Редис': 'radish',
  'Клубника': 'strawberry',
  'Малина': 'raspberry',
  'Смородина': 'black currant',
  'Виноград': 'grapes',
  'Яблоня': 'apple tree',
  'Груша': 'pear',
  'Вишня': 'sour cherry',
  'Укроп': 'dill',
  'Тыква': 'pumpkin',
  'Арбуз': 'watermelon',
  'Дыня': 'melon',
  'Горох': 'peas',
  'Фасоль': 'beans',
  'Кукуруза': 'corn',
  'Брокколи': 'broccoli',
  'Сельдерей': 'celery',
  'Шпинат': 'spinach',
  'Салат': 'lettuce',
  'Петрушка': 'parsley',
  'Базилик': 'basil',
  'Мята': 'mint',
  'Редька': 'black radish',
  'Слива': 'plum',
  'Абрикос': 'apricot',
  'Крыжовник': 'gooseberry',
  'Облепиха': 'sea buckthorn',
  'Ежевика': 'blackberry',
  'Хрен': 'horseradish',
  'Цветная капуста': 'cauliflower',
  'Брюссельская капуста': 'Brussels sprouts',
  'Кольраби': 'kohlrabi',
  'Пекинская капуста': 'Chinese cabbage',
  'Патиссон': 'pattypan squash',
  'Репа': 'turnip',
  'Брюква': 'rutabaga',
  'Пастернак': 'parsnip',
  'Топинамбур': 'Jerusalem artichoke',
  'Спаржа': 'asparagus',
  'Артишок': 'artichoke',
  'Ревень': 'rhubarb',
  'Лук-порей': 'leek',
  'Лук-батун': 'spring onion',
  'Шалот': 'shallot',
  'Дайкон': 'daikon radish',
  'Стручковая фасоль': 'green beans',
  'Черри-томат': 'cherry tomatoes',
  'Физалис': 'physalis',
  'Батат': 'sweet potato',
  'Корнишоны': 'gherkins',
  'Перец чили': 'chili pepper',
  'Мангольд': 'Swiss chard',
  'Цикорий': 'chicory',
  'Кресс-салат': 'watercress',
  'Корневая петрушка': 'parsley root',
  'Корневой сельдерей': 'celeriac',
  'Горчица салатная': 'mustard greens',
  'Кинза': 'cilantro',
  'Руккола': 'arugula',
  'Щавель': 'sorrel',
  'Тимьян': 'thyme',
  'Розмарин': 'rosemary',
  'Шалфей': 'sage',
  'Мелисса': 'lemon balm',
  'Душица': 'oregano',
  'Эстрагон': 'tarragon',
  'Майоран': 'marjoram',
  'Кервель': 'chervil',
  'Фенхель': 'fennel',
  'Любисток': 'lovage',
  'Чабер': 'summer savory',
  'Жимолость': 'honeyberry',
  'Голубика': 'blueberries',
  'Брусника': 'lingonberries',
  'Клюква': 'cranberries',
  'Земляника садовая': 'wild strawberries',
  'Ирга': 'serviceberries',
  'Арония': 'chokeberries',
  'Калина': 'viburnum berries',
  'Шиповник': 'rose hips',
  'Актинидия': 'kiwifruit',
  'Красная смородина': 'red currant',
  'Белая смородина': 'white currant',
  'Персик': 'peach',
  'Черешня': 'sweet cherries',
  'Алыча': 'cherry plum',
  'Айва': 'quince',
  'Грецкий орех': 'walnuts',
  'Фундук': 'hazelnuts',
  'Миндаль': 'almonds',
  'Инжир': 'fig',
  'Хурма': 'persimmon',
  'Гранат': 'pomegranate',
  'Рябина': 'rowan berries',
  'Кизил': 'cornelian cherries',
  'Лимон комнатный': 'lemon tree',
  'Колоновидная яблоня': 'columnar apple tree',
  'Мушмула': 'medlar',
  'Фейхоа': 'feijoa',
  'Бархатцы': 'marigold flowers',
  'Календула': 'calendula flowers',
  'Настурция': 'nasturtium flowers',
  'Петуния': 'petunia flowers',
  'Роза': 'rose',
  'Георгин': 'dahlia flowers',
  'Тюльпан': 'tulip flowers',
  'Пион': 'peony flowers',
  'Лаванда': 'lavender',
  'Хризантема': 'chrysanthemum flowers',
};

let classifierPromise;

function reportProgress(progress, onProgress) {
  if (typeof onProgress !== 'function') return;
  if (progress.status === 'progress' && Number.isFinite(progress.progress)) {
    onProgress(Math.max(0, Math.min(100, Math.round(progress.progress))));
  } else if (progress.status === 'done') {
    onProgress(100);
  }
}

async function getClassifier(onProgress) {
  if (!classifierPromise) {
    classifierPromise = (async () => {
      const { env, pipeline } = await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.2');
      env.allowLocalModels = false;
      env.allowRemoteModels = true;
      env.useBrowserCache = true;
      return pipeline('zero-shot-image-classification', MODEL, {
        progress_callback: progress => reportProgress(progress, onProgress),
      });
    })().catch(error => {
      classifierPromise = null;
      throw error;
    });
  }
  return classifierPromise;
}

export async function recognizeCatalogPlant(imageData, catalog, onProgress) {
  if (typeof imageData !== 'string' || !imageData.startsWith('data:image/jpeg;base64,')) {
    throw new Error('Сначала выберите фотографию в формате JPEG.');
  }
  if (!Array.isArray(catalog) || catalog.some(plant => !ENGLISH_NAMES[plant.n])) {
    throw new Error('Не удалось подготовить список растений для распознавания.');
  }

  const classifier = await getClassifier(onProgress);
  const labels = catalog.map(plant => ENGLISH_NAMES[plant.n]);
  if (new Set(labels).size !== labels.length) {
    throw new Error('В каталоге есть одинаковые названия для распознавания.');
  }
  const output = await classifier(imageData, labels, {
    hypothesis_template: 'a photo of {}',
    top_k: 5,
  });
  return output.map(result => ({
    catalogIndex: labels.indexOf(result.label),
    score: result.score,
  })).filter(result => result.catalogIndex >= 0);
}

window.SadovestVision = { recognizeCatalogPlant };
