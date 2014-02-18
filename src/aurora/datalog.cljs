(ns aurora.datalog
  (:require clojure.set)
  (:require-macros [aurora.macros :refer [check deftraced]]
                   [aurora.match :refer [match]]
                   [aurora.datalog :refer [rule defrule q* q? q!]]))

;; TODO naming is inconsistent

(defrecord Knowledge [axiom-eavs cache-eavs e->a->vs a->e->vs rules])

(defn add-eav
  ([knowledge eav]
   (add-eav knowledge eav true))
  ([knowledge eav axiom?]
   (let [[e a v] eav
         vs (conj (get-in knowledge [:e->a->vs e a] #{}) v)
         knowledge (-> knowledge
                       (update-in [:cache-eavs] conj eav)
                       (assoc-in [:e->a->vs e a] vs)
                       (assoc-in [:a->e->vs a e] vs))]
     (if axiom?
       (update-in knowledge [:axiom-eavs] conj eav)
       knowledge))))

(defn fixpoint
  ([knowledge rules]
   (let [new-knowledge (reduce
                        (fn [knowledge rule]
                          (reduce #(add-eav %1 %2 false) knowledge (rule knowledge)))
                        knowledge
                        rules)]
     (if (not= knowledge new-knowledge)
       (recur new-knowledge rules)
       knowledge)))
  ([knowledge]
   (reduce fixpoint knowledge (:rules knowledge))))

(defn knowledge [facts rules]
  (fixpoint (reduce add-eav (Knowledge. #{} #{} {} {} rules) facts)))

(defn know [knowledge & facts]
  (fixpoint (reduce add-eav knowledge facts)))

(defn unknow [knowledge & facts]
  (let [new-facts (clojure.set/difference (:axiom-eavs knowledge) facts)]
    (fixpoint (reduce add-eav (Knowledge. #{} #{} {} {} (:rules knowledge)) facts))))

;; TODO needs auto stratification
#_(defn learn [knowledge & rules]
    (fixpoint (reduce #(update-in %1 [:rules] conj %2) knowledge rules)))

(defn has-one [a v!]
  (fn [knowledge]
    (doseq [[e vs] (get-in knowledge [:a->e->vs a])]
      (check (<= (count vs) 1))
      (doseq [v vs] (v! knowledge v)))))

(defn has-many [a v!]
  (fn [knowledge]
    (doseq [[e vs] (get-in knowledge [:a->e->vs a])]
      (doseq [v vs] (v! knowledge v)))))

(defn id? [id]
  (string? id))

(defn id! [& as]
  (fn [kn id]
    (check (id? id))
    (doseq [a as]
      (check (seq (has kn id a))))
    true))

(defn group [name & as]
  (fn [knowledge]
    (for [[e a->vs] (:e->a->vs knowledge)
          :when (some #(seq (get a->vs %)) as)]
      [e name true])))

(defn required [name & as]
  (fn [knowledge]
    (for [[e a->vs] (:e->a->vs knowledge)
          :when (some #(seq (get a->vs %)) as)]
      (do (check (every? #(seq (get a->vs %)) as))
        [e name true]))))

;; TODO exclusive can potentially be extensible
(defn exclusive [name & as]
  (fn [knowledge]
    (for [[e a->vs] (:e->a->vs knowledge)
          :when (some #(seq (get a->vs %)) as)]
      (do (check (<= (count (filter #(seq (get a->vs %)) as)) 1))
        [e name true]))))

(defn has
  ([kn e]
   (get-in kn [:e->a->vs e]))
  ([kn e a]
   (get-in kn [:e->a->vs e a]))
  ([kn e a v]
   (get-in kn [:e->a->vs e a v])))

(comment

  ((rule
       [?x ?relates ?z]
       [?y ?relates ?z]
       (not= x y)
       :return
       [x :likes y]
       [y :likes x])
   (knowledge
    #{[:jamie :likes :datalog]
       [:jamie :likes :types]
       [:jamie :hates :types]
       [:chris :likes :datalog]
       [:chris :hates :types]}))

  ((rule
    [?x :likes ?z]
    [?y :hates ?z]
    (not= x y)
    :return
    [x :hates y])
   (knowledge
    #{[:jamie :likes :datalog]
      [:jamie :likes :types]
      [:jamie :hates :types]
      [:chris :likes :datalog]
      [:chris :hates :types]}))

  (def marmite
    (knowledge
     #{[:jamie :likes :datalog]
       [:jamie :likes :types]
       [:jamie :hates :types]
       [:chris :likes :datalog]
       [:chris :hates :types]}
     [[(rule
        [?x ?relates ?z]
        [?y ?relates ?z]
        (not= x y)
        :return
        [x :likes y]
        [y :likes x])
       (rule
        [?x :likes ?z]
        [?y :hates ?z]
        (not= x y)
        :return
        [x :hates y])
       (rule
        [?x :likes ?y]
        [?x :hates ?y]
        (not= x y)
        :return
        [x :marmites y])]]))

  (:cache-eavs marmite)
  (:e->a->vs marmite)

  (q* marmite [:jamie ?relates :chris] :return relates)

  (q* (unknow marmite [:chris :hates :types]) [:jamie ?relates :chris] :return relates)

  (q* marmite [?entity ?relates :chris] :ignore (assert (keyword? relates)))

  (q* marmite [?entity ?relates :chris] :ignore (assert (= :impossible relates)))

  (q? marmite [:jamie ?relates :chris])

  (q? marmite [:jamie ?relates :bob])

  (q! marmite [:jamie ?relates :chris] :return relates)

  (q! marmite [:jamie ?relates :chris] :return relates relates)

  (knowledge #{[:jamie :person/age 27] [:jamie :person/height 11]} [[(has-one :person/age #(check (number? %2)))]])

  (knowledge #{[:jamie :person/age "27"] [:jamie :person/height 11]} [[(has-one :person/age #(check (number? %2)))]])

  (knowledge #{[:jamie :person/age 27] [:jamie :person/age 11]} [[(has-one :person/age #(check (number? %2)))]])

  (knowledge #{[:jamie :person/age 27] [:jamie :person/height 11]} [[(required :person :person/age :person/height)]])

  (knowledge #{[:jamie :person/height 11]} [[(required :person :person/age :person/height)]])

  (knowledge #{[:jamie :person/age 27] ["isbn123" :book/title "Return of the King"]} [[(exclusive :kind :person/age :book/title)]])

  (knowledge #{[:jamie :person/age 27] [:jamie :book/title "Return of the King"]} [[(exclusive :kind :person/age :book/title)]])
  )
