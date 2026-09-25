@{{ item.citationKey | default: item.DOI | default: item.title | default: item.key }}{% suffix %}
